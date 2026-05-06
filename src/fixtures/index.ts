import type { ClientWorkspace } from '@/types';

import { tradesContractorFixture } from './trades-contractor';
import { professionalServicesFixture } from './professional-services';
import { retailFixture } from './retail';
import { restaurantFixture } from './restaurant';
import { saasFixture } from './saas';
import { genericSmbFixture } from './generic-smb';

export { tradesContractorFixture } from './trades-contractor';
export { professionalServicesFixture } from './professional-services';
export { retailFixture } from './retail';
export { restaurantFixture } from './restaurant';
export { saasFixture } from './saas';
export { genericSmbFixture } from './generic-smb';

export const ALL_FIXTURES: ClientWorkspace[] = [
  tradesContractorFixture,
  professionalServicesFixture,
  retailFixture,
  restaurantFixture,
  saasFixture,
  genericSmbFixture,
];

export const FIXTURES_MAP: Record<string, ClientWorkspace> = Object.fromEntries(
  ALL_FIXTURES.map((f) => [f.id, f])
);
