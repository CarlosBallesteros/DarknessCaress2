import { TopMenu } from "../components/TopMenu";

export function Store() {
  return (
    <main className="page-with-menu">
      <TopMenu />
      <section className="store-page" aria-labelledby="store-title">
        <div className="store-card">
          <h1 id="store-title">Store</h1>
          <p className="coming-soon">Coming soon…</p>
          <p className="store-copy">
            New themes and cosmetics will appear here in a future update.
          </p>
        </div>
      </section>
    </main>
  );
}
