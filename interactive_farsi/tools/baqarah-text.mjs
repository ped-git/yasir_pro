export function normalizeBaqarahVerse(verse, text) {
  let normalized = text
    .replace(/می {2,}/gu, 'می‌')
    .replace(/\s+([،؛؟.!])/gu, '$1')
    .replace(/([،؛؟.!])(?=[\p{L}\p{N}])/gu, '$1 ')
    .replace(/ {2,}/gu, ' ');

  if (verse === 23) {
    normalized = normalized
      .replace('بنده خود] محمّد (صلی الله علیه وآله)]', 'بنده خود [محمّد (صلی الله علیه وآله)]')
      .replace('آن رابیاورید', 'آن را بیاورید')
      .replace(
        'اگر [در گفتار خود که این قرآن ساخته بشر است نه وحی الهی [راستگویید',
        'اگر [در گفتار خود که این قرآن ساخته بشر است نه وحی الهی] راست‌گویید',
      );
  }

  if (verse === 37) {
    normalized = normalized
      .replace('کلماتی را] مانند', 'کلماتی را [مانند')
      .replace('و [پروردگار [توبه اش را پذیرفت', 'و [پروردگار توبه‌اش را پذیرفت')
      .replace('بسیار توبه پذیر و مهربان است.', 'بسیار توبه‌پذیر و مهربان است].');
  }

  return normalized;
}
