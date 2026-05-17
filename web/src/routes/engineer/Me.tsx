import { useIsMobile } from '../../hooks/useIsMobile';
import EngineerMobile from './Mobile';
import EngineerPc from './Pc';

/** Viewport-based dispatch: phones get the bottom-nav surface, laptops get
 *  the wide desk view. Same data, different layout, same data hooks. */
export default function EngineerMe() {
  const isMobile = useIsMobile(); // <= 767px → Mobile
  return isMobile ? <EngineerMobile /> : <EngineerPc />;
}
