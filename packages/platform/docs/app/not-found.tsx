import Link from 'next/link';

export const metadata = {
  title: 'Not Found — Dunena Docs',
};

export default function NotFound() {
  return (
    <>
      <aside className="sidebar"></aside>
      <div className="main" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingTop: '10vh'}}>
        <h1 style={{fontSize: '4rem', marginBottom: '0.5rem'}}>404</h1>
        <p style={{fontSize: '1.2rem', color: 'var(--dim)', marginBottom: '2rem'}}>The page you are looking for does not exist.</p>
        <Link href="/" className="btn btn-primary">Return Home</Link>
      </div>
    </>
  );
}
