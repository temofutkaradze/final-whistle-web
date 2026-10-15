export default function NotFound() {
  return (
    <div className="narrow">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p className="lead">The page you are looking for does not exist or has moved.</p>
      <p style={{ marginTop: 24 }}>
        <a className="btn" href="/">
          Back to home
        </a>
      </p>
    </div>
  );
}
