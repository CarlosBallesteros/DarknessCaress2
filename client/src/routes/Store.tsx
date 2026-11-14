import { TopMenu } from "../components/TopMenu";
import "../styles/Store.css";

export function Store() {
  return (
    <div className="page-shell">
      <TopMenu />
      <main className="page-content store-page">
        <section className="card store-card">
          <h1>Store</h1>
          <p className="store-coming">Coming soon…</p>
          <p className="store-flavor">
            New banners, relics, and warrior themes will one day gather here under the lamplight.
          </p>
        </section>
      </main>
    </div>
  );
}
