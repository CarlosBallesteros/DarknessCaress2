import "../styles/store.css";

// 05: flavor page — "Coming soon…" over dark-fantasy dressing. No
// functionality in MVP (00 product inventory: placeholder for a future real
// store).
export function Store(): React.JSX.Element {
  return (
    <section className="store-page">
      <h1 className="display">Store</h1>
      <div className="card store-card">
        <p className="store-soon display">Coming soon…</p>
        <p className="store-note">
          New themes and cosmetics will be sold here when the darkness opens its market.
        </p>
      </div>
    </section>
  );
}
