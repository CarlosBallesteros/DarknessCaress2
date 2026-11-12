import { TopMenu } from "../components/TopMenu";

export function Store() {
  return (
    <main className="page-with-menu">
      <TopMenu />
      <section className="store-page" style={{ padding: "2rem", textAlign: "center" }}>
        <h1>Store</h1>
        <p className="coming-soon">Coming soon…</p>
      </section>
    </main>
  );
}
