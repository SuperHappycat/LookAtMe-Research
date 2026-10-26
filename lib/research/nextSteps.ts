/**
 * lib/research/nextSteps.ts
 * ===========================
 * "What to do next" text on the summary and the printed report, per risk level. Plain language for parents.
 * Edit the wording here (clinical review needed before real use). Thai first, English second.
 */

import type { RiskLevel } from "../scoring";

export interface NextStepsText {
  headline: { th: string; en: string };
  steps: { th: string; en: string }[];
}

export const NEXT_STEPS: Record<RiskLevel, NextStepsText> = {
  Low: {
    headline: {
      th: "การทดสอบนี้ไม่พบสัญญาณที่น่ากังวล",
      en: "This test did not find signs of concern.",
    },
    steps: [
      { th: "พาเด็กไปตรวจพัฒนาการตามนัดปกติ", en: "Keep going to routine child health and development check-ups." },
      { th: "เล่น พูดคุย และอ่านหนังสือกับเด็กทุกวัน", en: "Play, talk and read with your child every day." },
      {
        th: "ถ้ายังกังวลเรื่องพัฒนาการ ให้ปรึกษาแพทย์ได้เสมอ แม้ผลนี้จะปกติ",
        en: "If you are still worried about your child's development, talk to a doctor, even with this result.",
      },
    ],
  },
  Moderate: {
    headline: {
      th: "พบสัญญาณบางอย่างที่ควรติดตาม",
      en: "Some signs should be followed up.",
    },
    steps: [
      { th: "ปรึกษากุมารแพทย์ และนำรายงานนี้ไปด้วย", en: "Talk to your child's doctor and bring this report." },
      { th: "ทำการคัดกรองซ้ำตามที่แพทย์แนะนำ", en: "Repeat the screening when the doctor advises." },
      { th: "เล่น พูดคุย และชวนเด็กมองหน้าและสิ่งของร่วมกันทุกวัน", en: "Every day, play and talk with your child, and share looking at faces and toys together." },
    ],
  },
  High: {
    headline: {
      th: "ควรได้รับการประเมินพัฒนาการเพิ่มเติม",
      en: "A full developmental assessment is recommended.",
    },
    steps: [
      {
        th: "นัดพบกุมารแพทย์พัฒนาการและพฤติกรรม หรือจิตแพทย์เด็กโดยเร็ว และนำรายงานนี้ไปด้วย",
        en: "Book a visit with a developmental-behavioral pediatrician or child psychiatrist soon, and bring this report.",
      },
      {
        th: "การช่วยเหลือตั้งแต่เนิ่น ๆ ช่วยให้เด็กพัฒนาได้ดีขึ้น ไม่ต้องรอผลการวินิจฉัยเพื่อเริ่มเล่นและพูดคุยกับเด็ก",
        en: "Early help makes a difference. You don't need to wait for a diagnosis to start playing and talking more with your child.",
      },
      { th: "ผลนี้ยังไม่ใช่การวินิจฉัย แพทย์จะเป็นผู้ประเมิน", en: "This result is not a diagnosis; a doctor will assess your child." },
    ],
  },
};

/** Shown with every result. */
export const SEE_A_DOCTOR_IF: { th: string; en: string }[] = [
  { th: "ไม่ส่งเสียงอ้อแอ้เมื่ออายุ 12 เดือน", en: "No babbling by 12 months" },
  { th: "ไม่พูดคำเดี่ยวเมื่ออายุ 16 เดือน", en: "No single words by 16 months" },
  { th: "ไม่พูดสองคำต่อกันเมื่ออายุ 24 เดือน", en: "No two-word phrases by 24 months" },
  { th: "ไม่หันเมื่อเรียกชื่อ หรือไม่ค่อยสบตา", en: "Does not respond to name, or rarely makes eye contact" },
  { th: "ทักษะที่เคยทำได้หายไป ไม่ว่าอายุเท่าใด", en: "Loses words or social skills at any age" },
];

/** Where to get help: edit for your organization. */
export const HELP_CONTACT = {
  th: "ติดต่อ: [ชื่อโรงพยาบาล/คลินิก] โทร [ ]",
  en: "Contact: [hospital/clinic name], phone [ ]",
};

export const NOT_DIAGNOSTIC = {
  th: "LookAtMe เป็นเครื่องมือคัดกรองเบื้องต้นสำหรับงานวิจัย ไม่ใช่เครื่องมือวินิจฉัยโรค",
  en: "LookAtMe is a preliminary research screening tool, not a diagnostic instrument.",
};
