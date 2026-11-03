import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPassagePlan } from './beta-passage-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const corpus = await read('data/beta/corpus.json');
const model = await read('data/beta/review-model.json');
const audit = await read('data/beta/changes.json');
const inventory = await read('data/beta/underline-audit.json');
const scopeAudit = await read('data/beta/scope-audit.json');
const plans = await loadPassagePlan(root);
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const digits = (value) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const normalize = (value) => value.normalize('NFC').toLocaleLowerCase().replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) % 16)).replace(/\s+/g, ' ').trim();
const statusNames = { decision: 'نیازمند تصمیم', pending: 'بازبینی ناتمام', 'source-check': 'بررسی منبع' };
const categories = {
  'Interpretive question': 'پرسش تفسیری',
  'Existing uncertain boundary': 'مرز نامطمئن موجود',
  'Pending speech-turn review': 'بازبینی نوبت گفتار',
  'Underline scope or type': 'ابهام در محدوده یا نوع زیرخط',
  'Context-sensitive pattern': 'الگوی وابسته به بافت',
  'Indirect-speech decision': 'تصمیم درباره گفتار غیرمستقیم',
  'Source numbering': 'شماره‌گذاری منبع',
  'Existing quotation balance': 'تطبیق نشانه‌های نقل‌قول موجود',
};
const roleNames = { good: 'خوب', bad: 'بد', neutral: 'خنثی' };
const questionFa = {
  '3:7': 'آیا مکث پس از «إلا الله» دانایان را از گفته پیشین جدا می‌کند یا به آن پیوند می‌دهد؟',
  '3:36': 'گوینده عبارت «وَلَيْسَ الذَّكَرُ كَالْأُنثَى» کیست و محدوده مقایسه چیست؟',
  '4:34': 'برای عبارت مورد اختلاف، کدام خوانش واژگانی و محدوده دقیق باید مبنا باشد؟',
  '4:48': 'آیا جمله آمرزش و نیامرزش باید نقش پیامد بگیرد یا نقش داوری؟',
  '5:3': 'آیا موارد ممنوع، خودشان بد هستند یا فقط درونِ عملِ ممنوع نقش منفی دارند؟',
  '5:95': 'چگونه گزینه‌های قانونیِ مشروط را جدا کنیم، بی‌آنکه همه شرط‌ها را عمل اخلاقی بشماریم؟',
  '6:59': 'آیا گزاره دانایی باید لایه مثبت جداگانه‌ای فراتر از فهرست خنثیِ اشیا داشته باشد؟',
  '7:143': 'تجلی، وضعیت کوه و واکنش موسی را چگونه از درخواست و پاسخ جدا کنیم؟',
  '8:23': 'چگونه شنیدن و روی‌گردانی فرضی را نشان دهیم بی‌آنکه وقوعشان را القا کنیم؟',
  '10:22': 'آیا «بد» در این تقابل شامل وضعیت نامساعد آب‌وهوا هم می‌شود یا فقط رفتار نکوهیده را؟',
  '12:24': 'محدوده و تفسیر دقیق عبارت‌های میلِ مشروط چیست؟',
  '13:41': 'محدوده عبارت کاهش زمین چیست و چه نقشی در استدلال دارد؟',
  '14:17': 'کدام بخش‌های وصف عذاب باید در یک گروهِ پیامد نامطلوب قرار گیرند؟',
  '15:23': 'افعال زندگی و مرگ چگونه از ادعای قدرت جدا شوند؟',
  '16:112': 'واژگونی وضعیت را یک لایه بیرونی بدانیم یا عمل و پیامد را جدا کنیم؟',
  '17:46': 'موانع فهم را وضعیت نامطلوب بدانیم یا در لایه اشیای خنثی نگه داریم؟',
  '18:49': 'چگونه اعمال ثبت‌شده را گروه‌بندی کنیم، وقتی هم کار نیک و هم بد را دربرمی‌گیرد؟',
  '19:58': 'آیا فهرست نیاکان باید با واکنش عبادی در یک لایه بیاید؟',
  '21:79': 'داوری و دانایی در کدام لایه معنایی باید نوع‌گذاری شوند؟',
  '24:27': 'ممنوعیت مشروطِ ورود کجا پایان می‌یابد و شرط اجازه از کجا آغاز می‌شود؟',
  '26:78': 'آیا آفرینش، روزی، بیماری، درمان، مرگ، زنده‌کردن و آمرزش یک نوع معنایی دارند؟',
  '27:82': 'محدوده دقیق گوینده و نقل‌قولِ خطاب این موجود چیست؟',
  '28:48': 'اتهام و انکار را چگونه از ارزیابیِ راوی جدا کنیم؟',
  '29:46': 'محدوده دقیق استثنای «إلا الذين ظلموا منهم» چیست؟',
  '30:11': 'مراحل آفرینش و بازگشت رویدادهایی خنثی‌اند یا بخشی از ادعای بزرگ‌ترِ قدرت؟',
  '33:50': 'کدام گروه‌های فهرست‌شده مشمول شرط هجرت و قید ویژه بعدی هستند؟',
  '36:12': 'آیا برای آنچه مردم پیش فرستاده‌اند و بر جای گذاشته‌اند می‌توان یک نوع خوب یا بد تعیین کرد؟',
  '37:158': 'ادعای خویشاوندیِ مردود را تا کجا باید مشخص کرد؟',
  '38:23': 'کدام ادعاهای طرفِ گفت‌وگو را می‌توان نوع‌گذاری کرد، بی‌آنکه گزارش او را واقعیت قطعی بدانیم؟',
  '39:21': 'رشد، زردشدن و خاشاک‌شدن محصول، وصف مرحله‌هاست یا نوع اخلاقی؟',
  '40:21': 'چگونه عذابِ روایت‌شده را از اعمال نکوهیده‌ای که به آن نسبت داده شده جدا کنیم؟',
  '41:21': 'گواهی اعضای بدن کجا پایان می‌یابد و توضیح راوی از کجا آغاز می‌شود؟',
  '42:31': 'آیا نبودِ سرپرست و یاور باید لایه نامطلوبی جدا از نقش‌های خنثیِ رابطه‌ای داشته باشد؟',
  '43:32': 'چگونه تفاوت روزی و درجات را نشان دهیم، بی‌آنکه رتبه اخلاقی به مردم نسبت دهیم؟',
  '28:61': 'در این مقایسه، بهره دنیوی نامطلوب است، خنثی است یا فقط در برابر وعده نیک قرار گرفته؟',
  '43:22': 'آیا استناد نقل‌شده به روش نیاکان ادعایی نکوهیده است یا باید به‌عنوان گفتار نقل‌شده خنثی بماند؟',
  '12:52': 'گوینده جمله‌های آیات ۵۲ و ۵۳ کیست؟',
  '19:24': 'ندا‌دهنده‌ای که با «من تحتها» توصیف شده کیست و گفتار او کجا پایان می‌یابد؟',
  '27:29': 'گزارش ملکه کجا باید نامه نقل‌شده را به‌صورت لایه‌ای در بر بگیرد؟',
  '27:34': '«وكذلك يفعلون» نتیجه‌گیری ملکه است یا تأیید راوی؟',
  '8:48': 'آیا «والله شديد العقاب» ادامه سخن نقل‌شده شیطان است یا بازگشت به توضیح الهی؟',
  '14:22': 'آیا «إن الظالمين لهم عذاب أليم» در گفتار شیطان است یا توضیح پیرامونی؟',
  '18:23': 'استثنای «إلا أن يشاء الله» چه نسبتی با گفته ممنوعِ نقل‌شده دارد؟',
  '27:25': 'آیا جمله وصفِ الهی در آیه ۲۶ هنوز سخن هدهد است؟',
  '29:26': 'گوینده جمله «إني مهاجر إلى ربي» کیست؟',
  '36:52': 'پس از پرسشِ بیدارشوندگان، چه کسی می‌گوید «هذا ما وعد الرحمن»؟',
  '39:53': 'فرمان «قل»، خطاب اول‌شخص الهی و پند بعدی چگونه باید لایه‌بندی شوند؟',
  '40:34': 'سخن مرد مؤمن کجا جای خود را به توضیح الهی می‌دهد؟',
  '43:88': '«وقيله يا رب» به چه کسی نسبت داده می‌شود و خطاب بعدی چه محدوده‌ای دارد؟',
  '16:88': 'آیا فعلِ زیان‌بار «صدوا عن سبيل الله» باید به‌سبب همانندی واژگانی، الگوی مثبتِ مرجع را بگیرد؟',
};

const alternativesFa = {
  '3:7': ['برداشت از محل مکث را از نقل پاسخ صریح آنان، «آمنا به»، جدا نگه دارید.', 'برداشت دیگری از محل مکث برگزینید، اما فقط پاسخ صریحِ گزارش‌شده را گفتار آنان بدانید.'],
  '12:52': ['این جمله‌ها را ادامه سخن همسرِ صاحب‌منصب بدانید.', 'آن‌ها را به یوسف نسبت دهید و نوبت گفتاری جداگانه‌ای مشخص کنید.'],
  '19:24': ['ندا را به فرشته نسبت دهید و رنگ متناسب با گوینده را برگزینید.', 'ندا را به کودک نسبت دهید و رنگ گفتار کودک را انتخاب کنید.'],
  '27:29': ['نقل بیرونی ملکه را نگه دارید و نامه را از عبارت «بسم الله الرحمن الرحيم» به‌صورت لایه درونی جدا کنید.', 'اگر آن بند را جزئی از نامه و نه مقدمه ملکه می‌دانید، نقل درونی را از «إنه من سليمان» آغاز کنید.'],
  '27:34': ['نقل پیوسته خاکستری را تا پایان آیه ۳۵، از جمله آن عبارت، حفظ کنید.', 'پیش از «وكذلك يفعلون» نقل را ببندید، آن را توضیح راوی بدانید و نقل ملکه را در آیه ۳۵ از سر بگیرید.'],
  '8:48': ['جمله پایانی را در گفتار قرمز شیطان بگنجانید.', 'نقل قرمز را پیش از جمله پایانی ببندید و آن را بیرون از گفتار نقل‌شده بگذارید.'],
  '14:22': ['نقل قرمز را تا جمله پایانی ادامه دهید.', 'پیش از جمله پایانی نقل را ببندید و آن را روایت یا توضیح بدانید.'],
  '18:23': ['گفته نقل‌شده را پیش از استثنا پایان دهید و استثنا را قید دستور بدانید.', 'با انتخاب یک خوانش نحوی، استثنا را نیز در گفته نقل‌شده بگنجانید.'],
  '27:25': ['نقل خاکستری هدهد را به آیه ۲۶ ادامه دهید.', 'گزارش نقل‌شده را در آیه ۲۵ ببندید و آیه ۲۶ را بی‌گوینده بگذارید.'],
  '29:26': ['جمله را به ابراهیم نسبت دهید.', 'با توجه به بافت جایگزین، جمله را به لوط نسبت دهید.'],
  '36:52': ['گفتار بیدارشوندگان را تا پاسخشان ادامه دهید.', 'این جمله را پاسخِ گوینده‌ای دیگر بدانید و برای او نقل و نقش جداگانه بگذارید.'],
  '39:53': ['یک نقل بیرونیِ گزارش‌شده از سوی پیامبر، با پایان مشخص، به‌کار ببرید.', 'پس از تعیین مرزها، نقل بیرونی را از خطاب درونیِ الهی جدا کنید.'],
  '40:34': ['آیه ۳۵ را ادامه گفتار مرد مؤمن بدانید.', 'نقل را در آیه ۳۴ ببندید و آیه ۳۵ را جداگانه در نظر بگیرید.'],
  '43:88': ['دعا را گفتار گزارش‌شده پیامبر بدانید و پاسخ را جداگانه محدود کنید.', 'پیش از تعیین نقل‌قول‌های صریح، پیوند نحوی جایگزین را انتخاب کنید.'],
  '16:88': ['الگوی نقطه‌چینِ فعل را به‌سبب نقش نکوهیده آن در این بافت حفظ کنید.', 'الگوی مرجع را فقط پس از اثبات یکسانی نقش دستوری و رابطه معنایی منتقل کنید.'],
  '3:36': ['ارجاعات مرد و زن را دسته‌های درونیِ خنثی نگه دارید و کل مقایسه را نوع‌گذاری نکنید.', 'ابتدا گوینده و واحد مقایسه را تعیین کنید؛ سپس درباره لایه معنایی بزرگ‌تر تصمیم بگیرید.'],
  '4:34': ['تا زمان تصمیم تفسیری صریح، گزاره‌های مورد اختلاف را بدون نوع نگه دارید.', 'فقط دسته‌های پیرامونیِ روشن را مشخص کنید و عبارت مورد اختلاف را حل‌شده نشان ندهید.'],
  '4:48': ['پیامد نامطلوب را از عمل بدی که سبب آن است جدا کنید.', 'فقط عملِ روشن و نکوهیده را نوع‌گذاری کنید و جمله داوری را نامشخص بگذارید.'],
  '5:3': ['در این بافت حقوقی، مواردِ مصرف ممنوع را نقطه‌چین کنید.', 'اسمِ اشیا را خنثی نگه دارید و در صورت نیاز، لایه مصرفِ بد را جداگانه مشخص کنید.'],
  '5:95': ['عمل ممنوعِ مقید را جدا از دسته‌های خنثیِ جبران زیرخط بکشید.', 'تا انتخاب مرزها و گزینه‌ها، ساختار حقوقیِ مشروط را نوع‌گذاری نکنید.'],
  '6:59': ['فهرست اشیای خنثی را نگه دارید و پس از تعیین محدوده، لایه داناییِ سودمند را جدا اضافه کنید.', 'بیان کلی دانایی را نامشخص بگذارید و فقط رابطه‌های روشن میان اشیا را نگه دارید.'],
  '7:143': ['رویدادها و وضعیت‌ها را خنثی نگه دارید و واکنش را سرزنش نکنید.', 'گزاره‌های رویدادی را نوع‌گذاری نکنید و فقط گفتار یا درخواست‌های بررسی‌شده را مشخص کنید.'],
  '8:23': ['لایه بیرونیِ شرط را نگه دارید و پاسخِ ارزیابی‌شده را درون آن جدا کنید.', 'تا تعیین مرز شرط و قاعده نوع‌گذاری، کل عبارت فرضی را معلق بگذارید.'],
  '10:22': ['در این بافت، باد مساعد را خوب و وضعیت خطرناک هوا را نامطلوب بگیرید.', 'نقطه‌چین را فقط برای رفتار نکوهیده به‌کار ببرید و وضعیت آب‌وهوا را خنثی نگه دارید.'],
  '12:24': ['عبارت‌های مورد اختلاف را بدون نوع نگه دارید.', 'پس از تعیین مرز دقیق، فقط حفاظت روشن از آسیب را مشخص کنید.'],
  '13:41': ['ارجاعات فیزیکی و رویدادی را خنثی نگه دارید و تفسیر گسترده‌تر را باز بگذارید.', 'تا روشن‌شدن مرجع و کارکرد عبارت، زیرخط تازه‌ای در آن نگذارید.'],
  '14:17': ['کل وضعیت نامطلوب را یک لایه نقطه‌چین بگیرید؛ جهت‌ها و زمان‌های درونی را فقط در صورت فهرست‌بودن جدا کنید.', 'پس از تعیین اینکه صورت‌های تکراری یک گروه‌اند یا نه، گزاره‌های نامطلوب را جداگانه مشخص کنید.'],
  '15:23': ['رویدادها را خنثی و ادعای قدرت را در لایه‌ای مثبت و جدا نگه دارید.', 'تا تعیین قرارداد خوب/بد در برابر مساعد/نامساعد، گزاره‌های گسترده‌تر را نامشخص بگذارید.'],
  '16:112': ['عمل نادرست و گرسنگی/ترسِ نامطلوب را در گروه‌های جداگانه نگه دارید.', 'لایه گسترده واژگونی را فقط پس از تعیین نحوه تو‌در‌تویی با وضعیت مساعد قبلی اضافه کنید.'],
  '17:46': ['گزاره‌های کاملِ مانع فهم را نقطه‌چین کنید و اسم اندام‌ها را در صورت نیاز خنثی بگذارید.', 'اگر نقطه‌چین فقط برای رفتار سرزنش‌شده است، وضعیت را خنثی و رفتارِ روی‌گردانی را جدا مشخص کنید.'],
  '18:49': ['اندازه‌ها را خنثی و نفیِ ستم را تضمینِ خوب نگه دارید.', 'فقط اعمالی را که به‌طور مشخص شناخته شده‌اند نقش‌دهی کنید، نه کل دفتر ثبت را.'],
  '19:58': ['نیاکان و ارجاعات را خنثی و عبادت را در لایه‌ای جداگانه مثبت نگه دارید.', 'تا انتخاب رابطه میان نیاکان، فقط واکنش عبادیِ بررسی‌شده را مشخص کنید.'],
  '21:79': ['گزاره‌های کاملِ بخشش و فهم را پیوسته و اسم‌های بخشیده‌شده را خط‌چین بگذارید.', 'اگر مقصود همین است، خودِ توانایی‌های ستوده‌شده را پیوسته کنید؛ دو لایه را یکی نکنید.'],
  '24:27': ['کل نهیِ مقید را یک دستور خوب نگه دارید.', 'پس از تعیین مرزهای تو‌در‌تو، بازداشتنِ خوب را از دسته‌های خنثی خانه و ساکنان جدا کنید.'],
  '26:78': ['رویدادهای خنثی، افعال مساعد و وضعیت‌های نامطلوب را در سطح عبارت‌های خود جدا کنید.', 'یک لایه ستایش یا توکلِ گسترده‌تر را پیوسته نگه دارید و نقش‌های درونی متفاوت را حفظ کنید.'],
  '27:82': ['تا تعیین محدوده و گوینده، خطاب و انتساب آن را نوع‌گذاری نکنید.', 'پس از تصمیم درباره گفتار مستقیم یا روایت، فقط بندهای درونیِ مرتبط و روشن را مشخص کنید.'],
  '28:48': ['ادعاهای خصمانه و محدود را نقطه‌چین کنید و وحی‌ها و پیامبرانِ نام‌برده را جدا نگه دارید.', 'تا تعیین مرجع‌ها و مرز دقیق، لایه گسترده اتهام را معلق بگذارید.'],
  '29:46': ['فقط دستورِ روشن و مقید به بهترین شیوه را زیرخط بکشید.', 'پس از تعیین پیوند استثنا، لایه بزرگ‌تری بسازید که آن را نیز در نظر بگیرد.'],
  '30:11': ['مراحل را در لایه‌ای جدا خنثی نگه دارید.', 'تا تعریف واحد معنایی، بیان گسترده‌تر را نوع‌گذاری نکنید.'],
  '33:50': ['اسم دسته‌های حقوقیِ روشن را خط‌چین کنید و همه شرط‌ها را یک‌جا گروه‌بندی نکنید.', 'پس از تعیین محدوده دقیق شرط‌ها، لایه اجازه مشروطِ گسترده‌تری اضافه کنید.'],
  '36:12': ['اشیای کلیِ ثبت‌شده را خنثی نگه دارید.', 'فقط اعمالی را که مشخصاً خوب یا بد هستند نوع‌گذاری کنید، نه دسته‌های ثبت را.'],
  '37:158': ['کل ادعای نادرست خویشاوندی را ادعایی بد بدانید و ارجاعات نام‌برده را جدا کنید.', 'تا تعیین مرجع‌ها و انتساب روایی، این مورد را باز بگذارید.'],
  '38:23': ['تعداد دارایی‌ها را خنثی نگه دارید و درخواستِ گزارش‌شده را از داوری بعدی جدا کنید.', 'لایه عمل بد را فقط با مشخص‌کردن صریحِ گزارش‌شده یا ادعایی بودن آن اضافه کنید.'],
  '39:21': ['مرحله‌های گیاه را توصیفی و خنثی نگه دارید.', 'یک لایه گسترده‌ترِ روزی یا یادآوریِ مساعد اضافه کنید، بی‌آنکه خود مرحله‌ها را خوب یا بد بدانید.'],
  '40:21': ['عملِ نادرستِ نام‌برده و پیامد نامطلوب را جداگانه نوع‌گذاری کنید.', 'اگر نقش اخلاقی و نقش پیامدی روشن نیست، گزاره کامل داوری را نامشخص بگذارید.'],
  '41:21': ['فقط بندِ صریحِ گواهی را در لایه گفتار نگه دارید.', 'پس از تصمیم درباره انتساب، همان گفتار را تا بندهای آفرینش و بازگشت ادامه دهید.'],
  '42:31': ['دو نقش رابطه‌ای را خنثی نگه دارید و در صورت نیاز، محرومیت از یاری را جدا نشان دهید.', 'تضمینِ منفیِ گسترده را نامشخص بگذارید تا با نهیِ خوب اشتباه نشود.'],
  '43:32': ['تفاوت‌های توصیف‌شده را خنثی نگه دارید.', 'پس از تعیین مرزها، لایه مقایسه‌ایِ روزی و رحمت را اضافه کنید.'],
  '28:61': ['بهره دنیوی را خنثی نگه دارید و فقط وعده نیک را مشخص کنید.', 'تقابل را به‌صورت کاملِ نیک/نامطلوب نشان دهید و عبارت داوری پایانی را نیز در نظر بگیرید.'],
  '43:22': ['کل استناد را به‌دلیل نکوهشِ زمینه بعدی، ادعایی بد بدانید.', 'تا تعیین سیاست نقل‌قول و نقد، گفته را خنثی نگه دارید.'],
};

function detailFa(issue) {
  const key = `${issue.surah}:${issue.firstVerse}`;
  if (questionFa[key]) return questionFa[key];
  if (issue.category === 'Interpretive question') return 'این مورد به انتساب گفتار، مرزبندی نقل‌قول یا کارکرد یک عبارت در بافت مربوط است؛ از رنگ یا نشانه‌گذاری به‌تنهایی نتیجه قطعی نگیرید.';
  if (issue.category === 'Underline scope or type') return 'واحد معنایی و محدوده عبارت باید پیش از انتخاب نقش خوب، بد یا خنثی روشن شود.';
  if (issue.category === 'Existing uncertain boundary') return `در منبع، مرز نقطه‌چینِ نامطمئنی برای این عبارت ثبت شده است: ${issue.detail.split(': ').slice(1).join(': ')}`;
  if (issue.category === 'Pending speech-turn review') {
    const match = issue.detail.match(/ — (\d+) reporting cue\(s\); (\d+) reviewed quotation span\(s\) cover this verse\./);
    return `این آیه هنوز از نظر نوبت گفتار کامل بازبینی نشده است. ${match ? `${digits(match[1])} نشانه گفتار و ${digits(match[2])} بازه نقل‌قولِ بازبینی‌شده دارد.` : 'مرزها و گویندگان هنوز تأیید نشده‌اند.'} متن آیه در پیش‌نمایش آمده است.`;
  }
  if (issue.category === 'Context-sensitive pattern') {
    const phrase = issue.detail.match(/^Phrase: (.*)\. Source pattern:/)?.[1];
    return `${phrase ? `عبارت «${phrase}»` : 'این عبارت'} در بافت‌های مختلف نقش یکسانی ندارد؛ الگوی رایج در موارد دیگر به‌تنهایی دلیل تغییر این مورد نیست.`;
  }
  if (issue.category === 'Indirect-speech decision') {
    const phrase = issue.detail.split(': ').at(-1);
    return `تا وقتی نقش این عبارت در گفتار و روایت روشن نشده، برای آن نقل‌قول مستقیم نسازید: «${phrase}»`;
  }
  if (issue.category === 'Source numbering') {
    const missing = issue.detail.match(/Missing verse labels: ([^;]+); repeated labels: ([^.]+)/);
    return missing ? `برچسب آیه‌های غایب: ${digits(missing[1])}؛ برچسب‌های تکراری: ${digits(missing[2])}. این فقط بررسی شماره‌گذاری است و به‌معنای افتادگی واژه‌های قرآن نیست.` : 'این مورد فقط شماره‌گذاری منبع را بررسی می‌کند، نه وجود یا نبود متن قرآن.';
  }
  if (issue.category === 'Existing quotation balance') return 'نشانه پایانیِ نقل‌قول با نشانه آغازینِ باز مطابقت ندارد؛ خودِ نشانه‌های منبع برای بررسی حفظ شده‌اند.';
  return 'این مورد برای بررسی و تصمیم‌گیری ثبت شده است.';
}

function alternativesFor(issue) {
  if (!issue.alternatives?.length) return [];
  return alternativesFa[`${issue.surah}:${issue.firstVerse}`] ?? [
    'محدوده و نقش روشن‌تر را جداگانه نگه دارید و از نتیجه‌گیری فراتر از متن بپرهیزید.',
    'پس از تعیین صریح گوینده، پیوند نحوی و نقش معنایی، لایه گسترده‌تر را ثبت کنید.',
  ];
}

function recommendationFa(issue) {
  if (issue.category === 'Underline scope or type') return 'نقش را از دستور، نفی یا واژه منفرد نتیجه نگیرید؛ محدوده و کارکرد کل عبارت را در بافت بسنجید.';
  if (issue.category === 'Interpretive question') return 'تا روشن‌شدن گوینده، پیوند نحوی یا مرز گفتار، انتخاب فعلی را قطعی تلقی نکنید.';
  if (issue.category === 'Existing uncertain boundary') return 'مرز نامطمئنِ منبع حفظ شده است؛ محدوده دقیق آن همچنان نیازمند بررسی است.';
  if (issue.category === 'Pending speech-turn review') return 'این نشانه به‌تنهایی ابهام تفسیری را ثابت نمی‌کند؛ بازبینی نوبت گفتار هنوز لازم است.';
  if (issue.category === 'Context-sensitive pattern') return 'الگو را از بافت محلی تعیین کنید؛ همانندی واژگان برای انتقال نوع از مورد دیگر کافی نیست.';
  if (issue.category === 'Indirect-speech decision') return 'تا تصمیم درباره گفتار و روایت، نقل‌قول تازه‌ای به متن نسبت داده نشود.';
  if (issue.category === 'Source numbering') return 'شماره‌گذاری منبع بدون تغییر حفظ شود؛ این اختلاف دلیلی بر افتادگی متن نیست.';
  return 'نشانه‌های نقل‌قول منبع حفظ شوند و برای تصمیم دقیق‌تر دوباره بررسی شوند.';
}

function currentChoiceFa(issue, page, related) {
  if (page.reference) return 'این صفحه مرجع است؛ نشانه‌های اصلی آن بدون تغییر حفظ شده‌اند و اصلاحی برایش ادعا نمی‌شود.';
  const quotes = related.filter((change) => change.kind === 'quotation');
  if (quotes.length) {
    const colors = { blue: 'آبی', green: 'سبز', red: 'قرمز', black: 'سیاه', gray: 'خاکستری', lightblue: 'آبی روشن', mixed: 'ترکیبی' };
    return quotes.map((quote) => `نقل‌قول ${colors[quote.color] ?? 'با رنگ محلی'} از «${quote.first}» آغاز می‌شود و ${quote.until ? `پیش از «${quote.until}» پایان می‌یابد` : `تا پایان آیه ${digits(quote.lastVerse)} ادامه دارد`}.`).join(' ');
  }
  const underlines = related.filter((change) => change.kind.includes('underline'));
  if (underlines.length) return `${digits(underlines.length)} تغییر مستند زیرخط در این محدوده ثبت شده است؛ نقل‌قول تازه‌ای برای آن تعیین نشده.`;
  if (issue.status === 'pending') return 'در این محدوده نقل‌قول یا زیرخط تازه‌ای ثبت نشده است؛ نشانه‌های موجود دست‌نخورده‌اند.';
  if (issue.status === 'source-check') return 'متن و شماره‌گذاری منبع بدون دست‌کاری حفظ شده‌اند.';
  return 'در این محدوده تصمیم تازه‌ای برای نقل‌قول یا زیرخط ثبت نشده؛ نشانه‌های منبع حفظ شده‌اند.';
}

const sections = corpus.pages.map((page) => {
  const items = model.issues.filter((issue) => issue.surah === page.surah);
  const entries = items.map((issue) => {
    const range = page.verses.filter((verse) => verse.verse >= issue.firstVerse && verse.verse <= issue.lastVerse);
    const verses = range.length > 3 ? [range[0], range.at(-1)] : range;
    const location = `${digits(page.surah)}:${digits(issue.firstVerse)}${issue.lastVerse !== issue.firstVerse ? `-${digits(issue.lastVerse)}` : ''}`;
    const search = normalize(`${page.surah} ${page.title} ${location} ${issue.category} ${issue.question} ${issue.detail} ${issue.recommendation} ${verses.map((verse) => verse.text).join(' ')}`);
    const related = audit.changes.filter((change) => change.surah === issue.surah && (change.kind === 'quotation' ? change.firstVerse <= issue.lastVerse && change.lastVerse >= issue.firstVerse : change.verse >= issue.firstVerse && change.verse <= issue.lastVerse));
    const alternatives = alternativesFor(issue);
    return `<details class="review-item" data-category="${escape(issue.category)}" data-status="${issue.status}" data-search="${escape(search)}" id="${escape(issue.id)}"><summary><span class="issue-location">${location}</span><span class="issue-category">${categories[issue.category] ?? 'مورد بازبینی'}</span><span class="issue-status">${statusNames[issue.status]}</span></summary><div class="issue-body"><h3>${escape(detailFa(issue))}</h3>${verses.length ? `<blockquote lang="ar" dir="rtl">${verses.map((verse) => `${escape(verse.text)} <small>(${digits(verse.verse)})</small>`).join('<br>')}</blockquote>` : ''}${alternatives.length ? `<div class="alternatives"><h4>گزینه‌های بررسی</h4><ol>${alternatives.map((alternative) => `<li>${escape(alternative)}</li>`).join('')}</ol></div>` : ''}<dl class="decision"><dt>وضعیت فعلی</dt><dd>${escape(currentChoiceFa(issue, page, related))}</dd><dt>پیشنهاد بازبینی</dt><dd>${escape(recommendationFa(issue))}</dd></dl><div class="issue-links"><a href="${escape(page.file)}" target="_blank" rel="noopener">بازکردن سوره ${digits(page.surah)}</a><a href="#${escape(issue.id)}" class="permalink">پیوند پایدار</a></div></div></details>`;
  }).join('\n');
  const applied = audit.changes.filter((change) => change.surah === page.surah);
  return `<section class="surah" data-surah="${page.surah}" data-reference="${page.reference}" id="surah-${page.surah}"><header class="surah-heading"><h2>${digits(page.surah)}. <span lang="ar">${escape(page.title)}</span></h2><span class="status">${page.reference ? 'مرجع محافظت‌شده؛ بدون تغییر' : `${digits(applied.filter((change) => change.kind === 'quotation').length)} بازه نقل‌قول؛ ${digits(applied.filter((change) => change.kind.includes('underline')).length)} تغییر زیرخط`}</span></header>${items.length ? entries : '<p class="no-issues">در این گذر موردی علامت‌گذاری نشد؛ این به‌معنای تأیید تفسیری نیست.</p>'}</section>`;
}).join('\n');

const inventoryRows = inventory.verses.map((row) => {
  const page = corpus.pages.find((entry) => entry.surah === row.surah);
  const states = {
    'explicit-passage-review': 'بازبینی صریح عبارت',
    'structural-candidate-unreviewed': 'نامزدِ بازبینی‌نشده؛ بدون تعیین نوع',
    'legacy-annotation-not-certified': 'زیرخط قدیمی؛ تأییدنشده',
    'no-simple-cue-not-certified': 'بدون نشانه ساده؛ تأییدنشده',
  };
  return `<tr data-surah="${row.surah}" data-status="${row.status}" data-search="${escape(normalize(`${row.surah}:${row.verse} ${row.text}`))}"><th scope="row"><a href="${escape(page.file)}" target="_blank" rel="noopener">${digits(row.surah)}:${digits(row.verse)}</a></th><td>${states[row.status]}</td><td>${digits(row.existingSpans)}</td><td lang="ar" dir="rtl">${escape(row.text)}</td></tr>`;
}).join('');

const coverageRows = plans.map((entry) => {
  const applied = entry.phrases.filter((phrase) => (audit.coverage ?? []).some((record) => record.surah === entry.surah && record.verse === entry.verse && record.phrase === phrase && record.groupId === `beta-${entry.surah}-${entry.group}` && record.members?.length)).length;
  const page = corpus.pages.find((item) => item.surah === entry.surah);
  const reason = entry.role === 'good'
    ? 'این گروه در این بافت، کنش یا پیامد پسندیده را نشان می‌دهد؛ لایه‌های درونی در صورت نیاز نقش جدا دارند.'
    : entry.role === 'bad'
      ? 'این گروه در این بافت، کنش نکوهیده یا پیامد نامطلوب را نشان می‌دهد؛ اشیای درونی به‌تنهایی بد شمرده نمی‌شوند.'
      : 'این گروه در این لایه نقش توصیفی یا ارجاعی دارد و به‌خودی‌خود خوب یا بد نیست.';
  return `<tr><th><a href="${escape(page.file)}" target="_blank" rel="noopener">${digits(entry.surah)}:${digits(entry.verse)}</a></th><td>${roleNames[entry.role]}</td><td lang="ar" dir="rtl">${entry.phrases.map(escape).join('؛ ')}</td><td>${digits(applied)}/${digits(entry.phrases.length)}</td><td>${reason}</td></tr>`;
}).join('');

const quotationRows = corpus.pages.filter((page) => !page.reference).map((page) => {
  const turns = audit.changes.filter((change) => change.kind === 'quotation' && change.surah === page.surah);
  return `<tr><th><a href="${escape(page.file)}" target="_blank" rel="noopener">${digits(page.surah)}. ${escape(page.title)}</a></th><td>${digits(turns.length)}</td><td>${digits(turns.filter((turn) => turn.speaker).length)}</td><td>${digits(turns.filter((turn) => turns.some((outer) => outer !== turn && outer.start < turn.start && turn.end <= outer.end)).length)}</td><td>${digits(turns.filter((turn) => turn.lastVerse > turn.firstVerse).length)}</td></tr>`;
}).join('');

const correctionNotes = [
  { location: '۴:۱۱۸-۱۱۹', previous: 'نقل قرمز از «ولأضلنهم» در آیه ۱۱۹ آغاز می‌شد و سوگند همان گوینده را در آیه پیش از آن دربرنمی‌گرفت.', corrected: 'آغاز نقل به «لأتخذن من عبادك» در آیه ۱۱۸ منتقل شد و تا پایان سوگند در آیه ۱۱۹ ادامه دارد؛ پیش از «ومن يتخذ» که هشدار و توضیح را آغاز می‌کند، پایان می‌یابد.', reason: '«وقال» در آیه ۱۱۸ آغاز گفتار اول‌شخصی است که با فعل‌های هم‌پایه در آیه ۱۱۹ ادامه پیدا می‌کند.' },
  { location: '۶:۵۰', previous: 'فقط پاسخ نخست پس از «قل» نشانه نقل‌قول داشت.', corrected: 'برای «هل يستوي الأعمى والبصير» پس از «قل» دوم، جفت نشانه‌ای جداگانه تا پایان آیه افزوده شد.', reason: 'فرمان دومِ گزارش گفتار، پاسخی جداگانه آغاز می‌کند و ادامه روایتِ پاسخ پیشین نیست.' },
  { location: '۶:۵۶', previous: 'فقط پاسخ نخست پس از «قل» نشانه نقل‌قول داشت.', corrected: 'برای «لا أتبع أهواءكم» پس از «قل» دوم، جفت نشانه‌ای جداگانه افزوده شد.', reason: 'پاسخ صریح دوم پیش‌تر نشانه‌های جفتِ مستقل نداشت.' },
];
const correctionRows = correctionNotes.map((item) => `<details><summary>${item.location} — اصلاح نقل‌قول</summary><dl class="decision"><dt>پیش از اصلاح</dt><dd>${item.previous}</dd><dt>اصلاح انجام‌شده</dt><dd>${item.corrected}</dd><dt>دلیل</dt><dd>${item.reason}</dd></dl></details>`).join('');

const categoriesOptions = Object.entries(categories).map(([key, value]) => `<option value="${escape(key)}">${value}</option>`).join('');
const surahOptions = corpus.pages.map((page) => `<option value="${page.surah}">${digits(page.surah)} - ${escape(page.title)}</option>`).join('');
const html = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>گزارش پرسش‌ها و بازبینی حاشیه‌گذاری</title><link rel="stylesheet" href="../fonts.css"><link rel="stylesheet" href="assets/beta-review.css"><link rel="stylesheet" href="assets/beta-review-fa.css"><script defer src="assets/beta-review-fa.js"></script></head>
<body><header class="masthead"><div class="inner"><nav class="language-links"><a href="index.html">خوانشگر بتا</a></nav><h1>گزارش پرسش‌ها و بازبینی حاشیه‌گذاری</h1><p>${digits(corpus.pages.length)} سوره بررسی شده‌اند؛ ${digits(82)} صفحه مرجع محافظت شده‌اند؛ ${digits(audit.quotationCount)} بازه نقل‌قول و ${digits(audit.underlineCount)} تغییر زیرخط در ${digits(32)} سوره هدف ثبت شده است.</p><p class="caution">این نسخه، گزارش ویرایشیِ آزمایشی است و تفسیر تأییدشده محسوب نمی‌شود. ${digits(model.counts.decision)} مورد نیازمند تصمیم حاشیه‌گذاری است؛ ${digits(model.counts.pending)} مورد در انتظار بررسی پوشش گفتار است و به‌تنهایی ابهام تفسیری ثابت‌شده نیست؛ ${digits(model.counts['source-check'])} مورد بررسی فنی منبع است.</p></div></header>
<main class="inner"><section class="principles"><h2>قاعده‌های معناشناختی</h2><ul><li><strong>خط پیوسته = خوب؛ نقطه‌چین = بد؛ خط‌چین = نه خوب و نه بد.</strong> نقش عبارت را در بافت بسنجید؛ شیء خنثی با عمل خوب یا بدِ پیرامونش یکی نیست.</li><li><strong>خاکستری گروه‌ها را جدا می‌کند، نه معناها را.</strong> گروه‌های نزدیک خاکستری متفاوت می‌گیرند و اعضای یک گروه رنگ یکسان دارند.</li><li><strong>سبز و قرمز فقط برای تقابل نزدیکِ خوب/بد هستند.</strong> سبز با خط پیوسته و قرمز با نقطه‌چین می‌آید؛ رنگ جای الگوی خط را نمی‌گیرد.</li><li>رنگ نقل‌قول گوینده را نشان می‌دهد و از خوب/بد بودن زیرخط مستقل است. هویت گوینده، همه واژه‌های نقل‌قول را خوب یا بد نمی‌کند.</li><li>لایه‌های تو‌در‌تو نقش‌های جدا دارند: نهیِ خوب می‌تواند کنش بد را در خود بگیرد و یک عمل خوب می‌تواند شیء خنثی داشته باشد.</li><li>متن قرآن، فاصله‌گذاری، خطوط عمودی و ۸۲ صفحه مرجع حفظ شده‌اند.</li></ul></section>
<section class="review-corrections"><h2>اصلاحات نقل‌قول در این بررسی</h2><p>مرزهای نقل‌قول با توجه به گوینده، ادامه گفتار و ورود روایت بازبینی شده‌اند. موارد زیر تغییرهای مشخص این گذر هستند.</p>${correctionRows}</section>
<section class="passage-coverage"><h2>بازبینی زیرخط‌ها</h2><p>${digits(model.coverage.phrases)} عبارت در ${digits(model.coverage.passages)} گروهِ متنی و هر ${digits(model.coverage.targetSurahs)} سوره هدف بررسی شده‌اند. ${digits(model.coverage.newSpans)} زیرخط تازه و ${digits(model.coverage.existingChanges)} تغییر در زیرخط‌های موجود ثبت شده است. این تعداد، تأیید معنایی همه عبارت‌های دیگر نیست.</p><details id="coverage-table"><summary>نمایش گروه‌های بررسی‌شده و نوع آن‌ها</summary><div class="table-scroll"><table><thead><tr><th>آیه</th><th>نقش</th><th>عبارت‌های بررسی‌شده</th><th>اجراشده</th><th>دلیل</th></tr></thead><tbody>${coverageRows}</tbody></table></div></details></section>
<section class="passage-coverage"><h2>بررسی نقل‌قول‌ها</h2><p>بازه‌های چندآیه‌ای، پاسخ‌های جداگانه، گفتار درون‌گفتار و موارد منتسب‌نشده جداگانه بررسی شده‌اند. نشانه گزارش به‌تنهایی اثبات نمی‌کند که جمله نقل‌قول مستقیم است.</p><details id="quotation-coverage"><summary>پوشش نقل‌قول در ۳۲ سوره هدف</summary><div class="table-scroll"><table><thead><tr><th>سوره</th><th>کل جفت‌ها</th><th>بازبینی گوینده</th><th>لایه تو‌در‌تو</th><th>چندآیه‌ای</th></tr></thead><tbody>${quotationRows}</tbody></table></div></details></section>
<section class="passage-coverage"><h2>بازبینی مرز گفتار و گروه‌های ذخیره‌شده</h2><ul><li>پاسخ کوتاه «الله» در ۶:۹۱ فقط پس از نشانه صریح «قل» آغاز می‌شود. برای واژه‌های تکرارشونده، انتخاب نشانه آغاز یا شماره رخداد الزامی است.</li><li>در روایت ساخت‌وسازِ ۱۸:۹۵-۹۶، دستورها از گزارش هموارکردن و گرم‌کردن جدا شده‌اند و دو نوبت بعدیِ «قال» نیز جدا هستند.</li><li>گزارش طرف گفت‌وگو در ۳۸:۲۳ لایه جدا دارد و عبارتِ ادعاییِ «أكفلنيها» در آن لایه‌ای درونی است؛ شرح فشار پس از آن درون این لایه قرار نمی‌گیرد.</li><li>نمایشگر، عضویت گروه‌ها را از متن یا ظاهر حدس نمی‌زند و فقط فهرست ذخیره‌شده را می‌خواند. در این بررسی ${digits(scopeAudit.savedGrouping.pages)} صفحه، ${digits(scopeAudit.savedGrouping.underlines)} شناسه زیرخط و ${digits(scopeAudit.savedGrouping.groups)} گروه با صفحه‌ها و داده‌هایشان تطبیق داده شده‌اند.</li></ul><p>بررسی نشانه‌های درون نقل‌قول ابزار تشخیصی است، نه اثبات درستی معنایی. پرسش‌های باقی‌مانده در فهرست پایین باز هستند.</p></section>
<section class="passage-coverage"><h2>فهرست کامل سوره‌های هدف</h2><p>در این گذر ${digits(inventory.summary.versesExamined)} آیه برچسب‌خورده از ${digits(inventory.summary.targetSurahs)} سوره هدف بررسی شده است. ${digits(inventory.summary.explicitReviewVerses)} آیه تصمیم صریح دارند و ${digits(inventory.summary.candidates)} آیه هنوز نشانه ساختاریِ بازبینی‌نشده دارند. این نامزدها خطای قطعی یا نقش معنایی تعیین‌شده نیستند.</p><details id="underline-inventory"><summary>مشاهده همه ${digits(inventory.summary.versesExamined)} آیه و نامزدهای باقیمانده</summary><div class="filters inventory-filters"><label>وضعیت فهرست<select id="inventory-state"><option value="structural-candidate-unreviewed">نامزدهای بررسی‌نشده (${digits(inventory.summary.candidates)})</option><option value="explicit-passage-review">بازبینی صریح</option><option value="legacy-annotation-not-certified">زیرخط قدیمی</option><option value="no-simple-cue-not-certified">بدون نشانه ساده</option><option value="">همه آیه‌ها</option></select></label><label>سوره<select id="inventory-surah"><option value="">همه ۳۲ سوره هدف</option>${corpus.pages.filter((page) => !page.reference).map((page) => `<option value="${page.surah}">${digits(page.surah)} - ${escape(page.title)}</option>`).join('')}</select></label><label class="search-label">جست‌وجو در فهرست<input id="inventory-search" type="search" placeholder="عبارت عربی یا شماره آیه"></label></div><p id="inventory-count" role="status"></p><div class="table-scroll inventory-table"><table><thead><tr><th>آیه</th><th>وضعیت بازبینی</th><th>زیرخط موجود</th><th>متن عربی</th></tr></thead><tbody>${inventoryRows}</tbody></table></div></details></section>
<form class="filters" role="search"><label>وضعیت بازبینی<select id="status-filter"><option value="decision" selected>نیازمند تصمیم (${digits(model.counts.decision)})</option><option value="pending">بازبینی ناتمام (${digits(model.counts.pending)})</option><option value="source-check">بررسی منبع (${digits(model.counts['source-check'])})</option><option value="">همه موارد (${digits(model.issues.length)})</option></select></label><label>سوره<select id="surah-filter"><option value="">همه ۱۱۴ سوره</option>${surahOptions}</select></label><label>نوع مورد<select id="category-filter"><option value="">همه انواع</option>${categoriesOptions}</select></label><label>محدوده<select id="scope-filter"><option value="">همه صفحه‌ها</option><option value="true">صفحه‌های مرجع</option><option value="false">سوره‌های هدف</option></select></label><label class="search-label">جست‌وجو<input id="search-filter" type="search" placeholder="عبارت عربی، آیه یا موضوع"></label><div class="filter-actions"><button id="expand-all" type="button">بازکردن موارد</button><button id="collapse-all" type="button">بستن موارد</button><button id="reset-filters" type="button">پاک‌کردن فیلترها</button></div></form><p id="visible-count" role="status"></p><p id="empty-state" hidden>موردی با این فیلترها پیدا نشد.</p>${sections}</main></body></html>`;

assert.equal((html.match(/class="surah"/g) ?? []).length, 114);
assert.equal((html.match(/class="review-item"/g) ?? []).length, model.issues.length);
await writeFile(path.join(root, 'annotation-review-fa.html'), html);
console.log(`Created Persian annotation report with 114 surahs and ${model.issues.length} review items.`);