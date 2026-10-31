import { ServiceType } from '../types';

export interface ServiceConfig {
  key: 'airtime' | 'data' | 'cable' | 'electricity' | 'waec' | 'jamb' | 'sms';
  service: ServiceType;
  label: string;
  icon: string; // Ionicons name
  color: string;
  route: string;
}

export const SERVICES: ServiceConfig[] = [
  { key: 'airtime', service: 'AIRTIME', label: 'Airtime', icon: 'phone-portrait-outline', color: '#2563EB', route: '/purchase/airtime' },
  { key: 'data', service: 'DATA', label: 'Data', icon: 'globe-outline', color: '#16A34A', route: '/purchase/data' },
  { key: 'cable', service: 'CABLE', label: 'Cable TV', icon: 'tv-outline', color: '#D97706', route: '/purchase/cable' },
  { key: 'electricity', service: 'ELECTRICITY', label: 'Electricity', icon: 'flash-outline', color: '#DC2626', route: '/purchase/electricity' },
  { key: 'waec', service: 'WAEC', label: 'WAEC', icon: 'school-outline', color: '#7C3AED', route: '/purchase/waec' },
  { key: 'sms', service: 'SMS', label: 'Bulk SMS', icon: 'chatbubbles-outline', color: '#0D9488', route: '/purchase/sms' },
];

/**
 * Label + icon lookup for every service a transaction can belong to.
 * JAMB is purchased from the WAEC screen (not a separate home tile), so it is
 * listed here for receipts / transaction history without adding a grid item.
 */
export const SERVICE_BY_TYPE: Record<string, ServiceConfig> = {
  ...Object.fromEntries(SERVICES.map((s) => [s.service, s])),
  JAMB: {
    key: 'jamb',
    service: 'JAMB',
    label: 'JAMB PIN Vending',
    icon: 'school-outline',
    color: '#7C3AED',
    route: '/purchase/waec',
  },
};
