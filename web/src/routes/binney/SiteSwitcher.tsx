import { Link, useLocation } from 'react-router-dom';

/** Nav link that flips between the UPark and Binney St versions of the
 *  current page: /binney/manager ⇄ /manager, /binney/admin ⇄ /admin.
 *  Rendered inside the Binney pages. The UPark headers use a plain
 *  <Link to="/binney/..."> instead of importing this component, so UPark
 *  never imports from routes/binney/* (isolation rule). */
export function SiteSwitcher() {
  const { pathname } = useLocation();
  const onBinney = pathname.startsWith('/binney');
  const href = onBinney ? pathname.replace(/^\/binney/, '') || '/' : `/binney${pathname}`;
  return (
    <Link to={href} className="t-small t-accent hover:underline">
      {onBinney ? '→ UPark' : '→ Binney St'}
    </Link>
  );
}
