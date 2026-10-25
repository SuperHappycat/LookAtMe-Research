/**
 * lib/research/plans.ts
 * =======================
 * The one place that says what each Research plan includes (spec §1).
 */

export type PlanKey = "school" | "behavioral_dev" | "hospital";
export type MemberRole = "admin" | "staff" | "viewer";

export interface PlanInfo {
  labelTh: string;
  labelEn: string;
  priceThbPerYear: number;
  screeningQuota: number | null; // null = unlimited
  seats: number;
  features: ReadonlySet<PlanFeature>;
}

export type PlanFeature =
  | "class_list_import"
  | "parent_letter"
  | "repeat_trend"
  | "clinic_logo"
  | "areas_of_interest"
  | "diagnosis_follow_up"
  | "blind_mode"
  | "group_summary"
  | "multi_site"
  | "custom_videos"
  | "raw_export";

export const PLANS: Record<PlanKey, PlanInfo> = {
  school: {
    labelTh: "โรงเรียน",
    labelEn: "School",
    priceThbPerYear: 1900,
    screeningQuota: 300,
    seats: 3,
    features: new Set<PlanFeature>(["class_list_import", "parent_letter"]),
  },
  behavioral_dev: {
    labelTh: "ศูนย์พัฒนาการ",
    labelEn: "Behavioral Development",
    priceThbPerYear: 2900,
    screeningQuota: 1000,
    seats: 5,
    features: new Set<PlanFeature>(["repeat_trend", "clinic_logo"]),
  },
  hospital: {
    labelTh: "โรงพยาบาล",
    labelEn: "Hospital",
    priceThbPerYear: 4900,
    screeningQuota: null,
    seats: 15,
    features: new Set<PlanFeature>([
      "repeat_trend",
      "areas_of_interest",
      "diagnosis_follow_up",
      "blind_mode",
      "group_summary",
      "multi_site",
      "custom_videos",
      "raw_export",
    ]),
  },
};

export function planHas(plan: PlanKey, feature: PlanFeature): boolean {
  return PLANS[plan]?.features.has(feature) ?? false;
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: "ผู้ดูแล / Admin",
  staff: "เจ้าหน้าที่ / Staff",
  viewer: "ดูอย่างเดียว / Viewer",
};
