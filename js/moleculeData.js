/**
 * moleculeData.js
 * -----------------------------------------------------------------------
 * Static catalogue of molecule "species" that make up the planet.
 * Every instanced molecule in the planet is tagged with a typeIndex that
 * points into MOLECULE_TYPES below. Kept dependency-free (pure data) so
 * it can be imported by both the render layer and any test/tooling code.
 */

export const MOLECULE_TYPES = [
  {
    id: 'h2o',
    formula: 'H₂O',
    name: 'آب',
    color: 0x4dd9c4,
    atomCount: 3,
    description:
      'فراوان‌ترین ترکیب روی سطح زمین و پایه‌ی اصلی حیات. از یک اتم اکسیژن و دو اتم هیدروژن ساخته شده که با زاویه‌ی خمیده به هم متصل‌اند.',
  },
  {
    id: 'co2',
    formula: 'CO₂',
    name: 'دی‌اکسید کربن',
    color: 0xe8a94d,
    atomCount: 3,
    description:
      'گازی خطی که موجودات زنده در تنفس تولید می‌کنند و گیاهان در فتوسنتز آن را جذب می‌کنند. یکی از گازهای اصلی گلخانه‌ای جو زمین است.',
  },
  {
    id: 'o2',
    formula: 'O₂',
    name: 'اکسیژن',
    color: 0x7fa8d4,
    atomCount: 2,
    description:
      'گازی حیاتی برای تنفس بیشتر موجودات زنده که حدود ۲۱ درصد از هوای زمین را تشکیل می‌دهد و از دو اتم اکسیژن ساخته شده.',
  },
  {
    id: 'n2',
    formula: 'N₂',
    name: 'نیتروژن',
    color: 0xd4a5d9,
    atomCount: 2,
    description:
      'فراوان‌ترین گاز جو زمین با سهم حدود ۷۸ درصد. پیوند بسیار قوی بین دو اتم نیتروژن آن را کم‌واکنش و پایدار می‌کند.',
  },
  {
    id: 'ch4',
    formula: 'CH₄',
    name: 'متان',
    color: 0x8fd48a,
    atomCount: 5,
    description:
      'ساده‌ترین هیدروکربن و جزء اصلی گاز طبیعی. یک اتم کربن در مرکز، با چهار اتم هیدروژن به شکل چهاروجهی احاطه شده.',
  },
  {
    id: 'nh3',
    formula: 'NH₃',
    name: 'آمونیاک',
    color: 0xd47f9b,
    atomCount: 4,
    description:
      'ترکیبی از نیتروژن و هیدروژن با بویی تند و مشخص. پایه‌ی تولید بسیاری از کودهای شیمیایی در کشاورزی است.',
  },
  {
    id: 'glucose',
    formula: 'C₆H₁₂O₆',
    name: 'گلوکز',
    color: 0xe8c94d,
    atomCount: 24,
    description:
      'قندی ساده و منبع اصلی انرژی سلول‌های بدن. گیاهان آن را طی فتوسنتز از دی‌اکسید کربن و آب می‌سازند.',
  },
  {
    id: 'h2',
    formula: 'H₂',
    name: 'هیدروژن',
    color: 0xb8c4cc,
    atomCount: 2,
    description:
      'سبک‌ترین و فراوان‌ترین عنصر شناخته‌شده در جهان. سوخت اصلی واکنش‌های همجوشی هسته‌ای در دل ستاره‌ها از جمله خورشید.',
  },
];

/** Returns a random type index, weighted equally. */
export function randomMoleculeTypeIndex(rng = Math.random) {
  return Math.floor(rng() * MOLECULE_TYPES.length);
}
