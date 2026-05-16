import { useSearchParams } from 'react-router-dom';
import ManagerPc from './Pc';
import ManagerTv from './Tv';

export default function Manager() {
  const [params] = useSearchParams();
  return params.get('mode') === 'tv' ? <ManagerTv /> : <ManagerPc />;
}
