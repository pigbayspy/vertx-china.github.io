import cliProgress from "cli-progress"
import fs from "fs-extra"
import download from "./download"
import extract from "./extract"
import { isAsciidocCompiled } from "./util"
import { metadata, latestRelease } from "../metadata/all"
import path from "path"
import Piscina from "piscina"
import pLimit from "p-limit"
import prettyMilliseconds from "pretty-ms"
import { MessageChannel } from "worker_threads"

const compiledPath = "compiled"
const downloadPath = "download"
const publicDocsPath = "../public/docs"

const piscina = new Piscina({
  filename: "./src/asciidoc-worker.js"
})

const multibar = new cliProgress.MultiBar({
  autopadding: true,
  hideCursor: true,
  stopOnComplete: true,
  format: function (options, params, payload) {
    if (!payload.message.startsWith("Download")) {
      return cliProgress.Format.Formatter({
        ...options,
        format: "{bar} {percentage}% | {value}/{total} | {message}",
        formatValue: function (v, options, type) {
          if (payload.asciidoc && (type === "total" || type === "value")) {
            v = Math.floor(v / 100)
          }
          return cliProgress.Format.ValueFormat(v, options, type)
        }
      }, params, payload)
    } else {
      return cliProgress.Format.Formatter({
        ...options,
        format: "{bar} {percentage}% | {value} MB/{total} MB | {message}",
        formatValue: function (v, options, type) {
          if (type === "total" || type === "value") {
            return cliProgress.Format.ValueFormat(Math.round(v / 1024 / 1024), options, type)
          }
          return cliProgress.Format.ValueFormat(v, options, type)
        }
      }, params, payload)
    }
  }
}, cliProgress.Presets.rect)

async function main() {
  const downloadLimit = pLimit(4)
  const extractLimit = pLimit(4)

  let start = +new Date()
  let totalMessages = 0
  let asciidoctorLog = await fs.open("asciidoctor.log", "w")
  let asciidoctorBar = multibar.create(metadata.length * 100, 0, {
    message: "Compile Asciidoc", asciidoc: true })

  async function run(version, artifactVersion) {
    let progressListener = {
      start(total, message) {
        this.stop()
        this.bar = multibar.create(total, 0, { message })
        if (this.bar === undefined) {
          console.log(message)
        }
      },

      update(value) {
        this.bar?.update(value)
      },

      stop() {
        if (this.bar !== undefined) {
          this.bar.stop()
          multibar.remove(this.bar)
        }
      }
    }

    // download artifact
    await downloadLimit(() => {
      return download(artifactVersion, progressListener)
    })
    progressListener.stop()

    // check if asciidoc for this version has already been compiled
    let asciidocCompiled = await isAsciidocCompiled(version, artifactVersion,
      downloadPath, compiledPath)

    // delete compiled files and extracted apidocs if SHA was different
    if (!asciidocCompiled) {
      let compiledVersionPath = path.join(compiledPath, version)
      let publicDocsVersionPath = path.join(publicDocsPath, version)
      await fs.remove(compiledVersionPath)
      await fs.remove(publicDocsVersionPath)
    }

    // extract artifact
    await extractLimit(() => {
      return extract(version, artifactVersion, progressListener, asciidocCompiled)
    })
    progressListener.stop()

    // create symlink to latest apidocs
    if (version === latestRelease.version) {
      let relativeTargetPath = `${version}/apidocs`
      let targetPath = path.join(publicDocsPath, relativeTargetPath)
      let symlinkPath = path.join(publicDocsPath, "apidocs")
      let skip = false
      try {
        let targetStat = await fs.stat(targetPath)
        let symlinkStat = await fs.stat(symlinkPath)
        if (targetStat.ino === symlinkStat.ino) {
          skip = true
        } else {
          await fs.unlink(symlinkPath)
        }
      } catch (e) {
        // ignore
      }
      if (!skip) {
        await fs.symlink(relativeTargetPath, symlinkPath, "junction")
      }
    }

    // compile asciidoc
    let lastProgress = 0
    let channel = new MessageChannel()
    channel.port2.on("message", (progress) => {
      if (progress !== lastProgress) {
        asciidoctorBar?.increment(progress - lastProgress)
        lastProgress = progress
      }
    })

    let messages = await piscina.run({ version, artifactVersion, progressPort: channel.port1, latestReleaseVersion: latestRelease.version },
      { transferList: [channel.port1] })

    channel.port1.close()
    channel.port2.close()

    if (lastProgress < 100) {
      asciidoctorBar?.increment(100 - lastProgress)
    }

    totalMessages += messages.length
    await fs.write(asciidoctorLog, messages.join("\n"))
  }

  try {
    let promises = []
    for (let m of metadata) {
      promises.push(run(m.version, m.metadata.artifactVersion || m.version))
    }
    await Promise.all(promises)
  } finally {
    await fs.close(asciidoctorLog)
  }

  asciidoctorBar?.stop()
  multibar.stop()

  if (totalMessages > 0) {
    console.log(`There were ${totalMessages} messages from Asciidoctor. ` +
      "Please review asciidoctor.log for more information.")
  }

  console.log(`update-docs finished in ${prettyMilliseconds(+new Date() - start)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})