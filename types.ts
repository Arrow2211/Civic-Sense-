
export enum ReportStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED'
}

export enum ReportCategory {
  GARBAGE = 'Garbage Dumping',
  WATER_LEAKAGE = 'Water Leakage',
  TREE_CUTTING = 'Illegal Tree Cutting',
  SMUGGLING = 'Smuggling Activity',
  POTHOLES = 'Potholes/Road Damage',
  OTHER = 'Other'
}

export interface User {
  id: string;
  username: string;
  email: string;
  mobile: string;
  role: 'citizen' | 'authority';
}

export interface Report {
  id: string;
  citizen_id: string;
  citizen_name: string;
  title: string;
  description: string;
  category: ReportCategory;
  location: string;
  timestamp: number;
  status: ReportStatus;
  media_url: string;
  media_type: 'image' | 'video';
  work_done_media_url?: string;
  work_done_description?: string;
  resolved_at?: number;
  notified: boolean;
}

export interface AuthoritySession {
  username: string;
  last_active: string;
}
