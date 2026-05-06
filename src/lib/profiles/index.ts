import { genericSmbProfile } from './generic-smb';
import { tradesContractorProfile } from './trades-contractor';
import { professionalServicesProfile } from './professional-services';
import { retailProfile } from './retail';
import { restaurantProfile } from './restaurant';
import { saasProfile } from './saas';
import type { IndustryProfile } from '@/types';

export const ALL_PROFILES: IndustryProfile[] = [
  genericSmbProfile,
  tradesContractorProfile,
  professionalServicesProfile,
  retailProfile,
  restaurantProfile,
  saasProfile,
];

export const PROFILE_MAP: Record<string, IndustryProfile> = Object.fromEntries(
  ALL_PROFILES.map((p) => [p.id, p])
);

export function getProfile(id: string): IndustryProfile {
  return PROFILE_MAP[id] ?? genericSmbProfile;
}

export {
  genericSmbProfile,
  tradesContractorProfile,
  professionalServicesProfile,
  retailProfile,
  restaurantProfile,
  saasProfile,
};
