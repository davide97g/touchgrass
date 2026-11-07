import { setPoolFilter } from '../Features';
import { mountainMask } from '../common';
import { getRealm, type Realm } from './World';

export type { Realm };

/** Build the realm and keep ponds out of everything it planned. */
export function initRealm(): Realm {
  const realm = getRealm();
  setPoolFilter((p) => !realm.map.busy(p.x, p.z, p.r * 2 + 6) && mountainMask(p.x, p.z) < 0.02);
  return realm;
}
