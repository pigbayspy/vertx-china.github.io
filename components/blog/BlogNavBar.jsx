import Link from "next/link"
import { Rss } from "react-feather"
import styles from "./BlogNavBar.scss?type=global"

const BlogNavBar = ({ categories }) => (
  <div className="blog-navbar">
    <h2>Blog</h2>
    <ul>
      <li><Link href="/blog/[[...slug]]" as="/blog/"><a>所有博文</a></Link></li>
      {categories.map(c => (
        <li key={c}>
          <Link href="/blog/[[...slug]]" as={`/blog/category/${c}/`}>
            <a>{c}</a>
          </Link>
        </li>
      ))}
      <li><Link href="/blog/[[...slug]]" as="/blog/translated/"><a>已翻译</a></Link></li>
    </ul>
    <div className="feed-icons">
      <a href="/feed/atom.xml"><Rss /></a>
    </div>
    <style jsx>{styles}</style>
  </div>
)

export default BlogNavBar
