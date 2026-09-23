// Buildings for the signed-in engineer's site — the building dropdown in the
// work-record form and the column set on the profile grid. UPark ids from
// useUparkBuildingIds; Binney = everything that is NOT UPark. Fails open
// (all buildings) while the id set loads.
import { useMemo } from 'react';
import { useBuildings } from './useBuildings';
import { useMySiteAccess, useUparkBuildingIds } from './useSiteScope';
import type { FormBuilding } from '../components/profile/WorkRecordForm';

/** Buildings for the signed-in engineer's site (UPark ids, or everything
 *  that is NOT UPark for Binney). Fails open while the id set loads. */
export function useSiteBuildings(): FormBuilding[] {
  const bq = useBuildings();
  const upark = useUparkBuildingIds();
  const access = useMySiteAccess();
  return useMemo(() => {
    const all = (bq.data ?? []) as FormBuilding[];
    if (!upark) return all;
    const isUpark = access.homeSite !== 'binney';
    return all.filter((b) => (isUpark ? upark.has(b.id) : !upark.has(b.id)));
  }, [bq.data, upark, access.homeSite]);
}

