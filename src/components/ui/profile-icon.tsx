'use client';

import {
  Building2,
  HardHat,
  Briefcase,
  Store,
  UtensilsCrossed,
  Cloud,
  type LucideIcon,
} from 'lucide-react';

/**
 * Maps each industry profile id to a Lucide icon component.
 * Centralized here so swapping or adding a new profile only touches
 * this file (plus the profile config in src/lib/profiles).
 *
 * Replaces the emoji-style profile.icon string field used previously —
 * the icon field is kept for backward compat but renderers should call
 * ProfileIcon instead.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  'generic-smb': Building2,
  'trades-contractor': HardHat,
  'professional-services': Briefcase,
  retail: Store,
  restaurant: UtensilsCrossed,
  saas: Cloud,
};

interface ProfileIconProps {
  profileId: string | undefined;
  className?: string;
  size?: number;
  'aria-hidden'?: boolean;
}

export function ProfileIcon({
  profileId,
  className,
  size = 20,
  ...rest
}: ProfileIconProps) {
  const Icon = (profileId && ICON_MAP[profileId]) || Building2;
  return <Icon size={size} className={className} aria-hidden {...rest} />;
}
