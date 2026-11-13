// ─── Telegram Supervisor Agent — BET Terminology Academy (14 lessons) ──────
// Rotating bilingual curriculum: the POSTER carries the English educational
// content; the CAPTION carries the complete Persian explanation. The lesson
// index advances once per AM slot; AM and PM always show consecutive topics.

export interface AcademyLesson {
  index: number; // 1..14
  term: string;
  phonetic: string;
  category: string;
  definition: string; // EN — poster
  example: string; // EN — poster
  explanationFa: string; // FULL Persian explanation — caption
  tipFa: string; // Persian pro tip — caption
}

export const ACADEMY: AcademyLesson[] = [
  {
    index: 1,
    term: "ASIAN HANDICAP",
    phonetic: "/ey-zhun han-di-kap/",
    category: "MARKET TYPE",
    definition:
      "A SPREAD MARKET THAT REMOVES THE DRAW BY GIVING ONE SIDE A HEAD START IN GOALS. YOUR STAKE WORKS ACROSS HALF-LINES AND QUARTER-LINES.",
    example: "HOME -0.75: HALF THE STAKE WINS IF HOME WINS BY 1, FULL STAKE WINS BY 2 OR MORE.",
    explanationFa:
      "هندیکپ آسیایی یکی از محبوب‌ترین بازارهای شرط‌بندی فوتبال است که مفهوم مساوی را حذف می‌کند. در این بازار یک طرف خطی از گل دریافت می‌کند (مثلاً ۰٫۷۵+) و طرف دیگر همان خط را می‌دهد. چون خط‌ها نیمه‌ای یا ربعی هستند، هیچ راهی برای مساوی شدن شرط وجود ندارد و استیک شما میان دو خط تقسیم می‌شود. مثلاً در هندیکپ ۰٫۷۵- میزبان، اگر تیم میزبان با یک گل ببرد نیمی از استیک برنده و نیمی پس گرفته می‌شود؛ اگر با دو گل یا بیشتر ببرد کل شرط برنده است؛ و اگر مساوی یا ببازد کل شرط می‌بازد. این بازار به شما اجازه می‌دهد در بازی‌های نامتوازن، ضرایب بهتری نسبت به برد ساده پیدا کنید.",
    tipFa:
      "نکته حرفه‌ای: در خط‌های ربعی (مثل ۰٫۲۵ و ۰٫۷۵) همیشه نیم‌باخت یا نیم‌برد دارید؛ قبل از شرط‌بندی، تفاوت خط یک‌چهارم و نیم را کامل یاد بگیرید تا در محاسبه سود دچار اشتباه نشوید.",
  },
  {
    index: 2,
    term: "OVER / UNDER GOALS",
    phonetic: "/oh-ver un-der gohlz/",
    category: "MARKET TYPE",
    definition:
      "A TOTALS MARKET ON THE NUMBER OF GOALS IN A MATCH. THE LINE 2.5 MEANS THE SUM OF BOTH TEAMS' GOALS DECIDES THE BET.",
    example: "OVER 2.5 GOALS PAYS WHEN THE MATCH ENDS WITH 3 OR MORE GOALS (E.G. 2-1).",
    explanationFa:
      "بازار بیش‌کمتر (Over/Under) روی مجموع گل‌های دو تیم شرط‌بندی می‌شود. خط ۲٫۵ یعنی مجموع گل‌های بازی باید بالای ۲٫۵ باشد تا شرط Over ببرد؛ یعنی سه گل یا بیشتر. نکته مهم این است که مالکیت گل‌ها مهم نیست و فقط مجموع گل‌ها سنجیده می‌شود. خط‌های معمول ۱٫۵ تا ۴٫۵ هستند و در لیگ‌های پرگل معمولاً ضریب خط پایین‌تر به سمت بازار پرگل متمایل است. تحلیل درست این بازار بر اساس میانگین گل زده و خورده دو تیم، سبک بازی و شرایط آب‌وهوا انجام می‌شود.",
    tipFa:
      "نکته حرفه‌ای: بازی‌های بارانی یا زمین‌های سخت معمولاً پرگل‌ترند، ولی تیم‌های مدعی در فصل پایانی برای حفظ نتیجه محتاط‌تر بازی می‌کنند؛ پیش از شرط Over، انگیزه دو تیم را هم بسنجید.",
  },
  {
    index: 3,
    term: "BTTS",
    phonetic: "/bee-tee-tee-ess/",
    category: "MARKET TYPE",
    definition:
      "BOTH TEAMS TO SCORE. YES PAYS WHEN EACH SIDE SCORES AT LEAST ONE GOAL IN NORMAL TIME; NO PAYS WHEN A CLEAN SHEET HAPPENS.",
    example: "BTTS YES IN A 1-1 OR 2-1 MATCH WINS. A 2-0 RESULT SETTLES BTTS NO.",
    explanationFa:
      "بازار گل‌زنی هر دو تیم (BTTS) به این معناست که آیا هر دو تیم در طول بازی حداقل یک گل می‌زنند یا نه. اگر انتخاب شما «بله» باشد و بازی ۱-۱ یا ۲-۱ تمام شود، شرط شما برنده است؛ حتی نتیجه ۰-۱ هم اگر تیم دیگر یک گل بزند برنده می‌شود. اما اگر یکی از تیم‌ها دروازه‌اش بسته بماند (مثلاً ۲-۰)، شرط «بله» می‌بازد. این بازار برای بازی‌های دو تیم تهاجمی با دفاع‌های ضعیف بسیار مناسب است و برخلاف برد و باخت به نتیجه نهایی حساس نیست.",
    tipFa:
      "نکته حرفه‌ای: آمار گل‌زنی در خانه و خارج را جداگانه ببینید؛ تیمی که در خانه همیشه گل می‌زند ولی در خارج خشک بازی می‌کند، رفتار کاملاً متفاوتی در این بازار دارد.",
  },
  {
    index: 4,
    term: "DOUBLE CHANCE",
    phonetic: "/duh-bul chans/",
    category: "MARKET TYPE",
    definition:
      "ONE BUTTON THAT COVERS TWO OF THE THREE MATCH OUTCOMES (1X, X2 OR 12). SAFEST MATCH-RESULT MARKET BUT WITH THE LOWEST ODDS.",
    example: "X2 WINS IF THE AWAY TEAM WINS OR THE MATCH IS A DRAW - ONLY A HOME WIN LOSES.",
    explanationFa:
      "شانس دوبل (Double Chance) یک بازار امنیتی است که دو نتیجه از سه نتیجه ممکن را یکجا پوشش می‌دهد. نماد ۱X یعنی برد میزبان یا مساوی، نماد X2 یعنی مساوی یا برد مهمان، و نماد 12 یعنی هر کدام برد باشد (بدون مساوی). ضریب این بازار پایین است اما احتمال برد آن حدود دو برابر شرط ساده است. برای پوشش ریسک در بازی‌های نزدیک یا زمانی که به شگفتی شکست ناپذیری یک تیم اعتماد دارید، انتخاب منطقی است.",
    tipFa:
      "نکته حرفه‌ای: در شرط‌بندی ترکیبی (پارلی) از شانس دوبل برای لگ پایه استفاده کنید تا احتمال شکست کل سبد کم شود، ولی مراقب باشید ضریب نهایی زیر ۱٫۳۰ نرود چون ارزش واقعی از بین می‌رود.",
  },
  {
    index: 5,
    term: "DRAW NO BET",
    phonetic: "/draw noh bet/",
    category: "MARKET TYPE",
    definition:
      "A TWO-WAY MARKET WHERE THE DRAW REFUNDS YOUR STAKE. YOU ONLY WIN WITH A CLEAR RESULT AND NEVER LOSE TO A TIE.",
    example: "DNB HOME: A 1-1 DRAW RETURNS YOUR MONEY. A HOME WIN PAYS THE FULL ODDS.",
    explanationFa:
      "در شرط «مساوی بدون باخت» (Draw No Bet) اگر بازی مساوی تمام شود کل استیک شما پس داده می‌شود و هیچ سود و زیانی ندارید. فقط برد یا باخت قطعی نتیجه شرط را تعیین می‌کند. این بازار در واقع ترکیبی از شرط ساده و بیمه مساوی است؛ ضریب آن کمی کمتر از برد ساده است اما ریسک مساوی را صفر می‌کند. برای بازی‌هایی که احتمال مساوی بالاست اما شما به برتری یکی از دو تیم مطمئن هستید، انتخاب هوشمندانه‌ای است.",
    tipFa:
      "نکته حرفه‌ای: تفاوت DNB و هندیکپ صفر (0.0) فقط در نام برند است؛ در هر دو، مساوی یعنی بازگشت کامل استیک. اگر ضریب یکی به‌طور غیرعادی بالاتر بود همان را انتخاب کنید.",
  },
  {
    index: 6,
    term: "1X2 MATCH RESULT",
    phonetic: "/wan eks too/",
    category: "MARKET TYPE",
    definition:
      "THE CLASSIC THREE-WAY FULL-TIME RESULT: 1 = HOME WIN, X = DRAW, 2 = AWAY WIN. THE DEFAULT FOOTBALL MARKET EVERYWHERE.",
    example: "PICK 2 AT 2.10 PAYS WHEN THE AWAY SIDE WINS IN NORMAL TIME.",
    explanationFa:
      "بازار ۱X2 کلاسیک‌ترین و پرکاربردترین بازار فوتبال است: عدد ۱ یعنی برد میزبان، ضربدر (X) یعنی مساوی و عدد ۲ یعنی برد مهمان. این شرط فقط به نتیجه ۹۰ دقیقه قانونی معتبر است و وقت‌های اضافه و پنالتی را شامل نمی‌شود (مگر برند بازار صراحتاً گفته باشد). ضریب‌های این بازار معمولاً بیشترین حجم را در کل بازار دارند و تحلیل اصلی هر بازی از همین‌جا شروع می‌شود.",
    tipFa:
      "نکته حرفه‌ای: همیشه چک کنید بازی در کدام جام و با چه قوانینی است؛ در جام حذفی با وقت اضافه، بعضی برندها نتیجه را تا پنالتی هم محاسبه می‌کنند و این تفاوت ضریب‌ها را جابه‌جا می‌کند.",
  },
  {
    index: 7,
    term: "CORRECT SCORE",
    phonetic: "/kuh-rekt skohr/",
    category: "MARKET TYPE",
    definition:
      "PREDICT THE EXACT FINAL SCORE. HIGH-ODDS SINGLE BUTTON WITH UP TO 20+ OUTCOMES - THE HARDEST RESULT MARKET TO HIT.",
    example: "CORRECT SCORE 2-1 TYPICALLY CARRIES ODDS FROM 6.00 UP TO 10.00+.",
    explanationFa:
      "بازار نتیجه دقیق (Correct Score) از شما می‌خواهد نتیجه نهایی بازی را دقیقاً حدس بزنید. چون بیش از بیست نتیجه ممکن وجود دارد، ضرایب بسیار بالا هستند و همین موضوع آن را جذاب اما پرریسک می‌کند. حرفه‌ای‌ها معمولاً با توزیع احتمال چند نتیجه محتمل را پوشش می‌دهند یا نتیجه دقیق را در ترکیب با بازارهای دیگر به‌عنوان لگ پرضریب استفاده می‌کنند. در تنیس نیز مشابه آن بازار نتیجه دقیق ست‌ها (Set Betting) با ترکیب‌های ۲-۰، ۲-۱ و ۱-۲ وجود دارد.",
    tipFa:
      "نکته حرفه‌ای: به‌جای پوشش کامل همه نتیجه‌ها، فقط دو نتیجه‌ای را انتخاب کنید که مدل آماری بالاترین احتمال را به آن‌ها می‌دهد؛ پوشش بیش از حد، ارزش (Value) را نابود می‌کند.",
  },
  {
    index: 8,
    term: "BANKROLL & UNITS",
    phonetic: "/bang-krol and yoo-nits/",
    category: "MONEY MANAGEMENT",
    definition:
      "THE DISCIPLINE OF STAKING A FIXED UNIT (1-2% OF THE BANK) PER PICK SO NO SINGLE LOSS CAN BREAK THE ACCOUNT.",
    example: "BANK 1000U - UNIT 10U: AFTER 3 LOSSES YOU STILL HOLD 970U AND FULL EDGE.",
    explanationFa:
      "مدیریت بانک (Bankroll) ستون فقرات حرفه‌ای بودن در شرط‌بندی است. کل سرمایه شما «بانک» نامیده می‌شود و هر شرط باید بر حسب «واحد» تعریف شود؛ معمولاً یک تا دو درصد بانک برای هر پیک. این نظم باعث می‌شود حتی یک رگبار باخت پیاپی هم بانک را از بین نبرد و شانس بازگشت باقی بماند. در سیستم ما هر کارت دقیقاً با واحد مشخص چاپ می‌شود و هیچ‌گاه اجازه ندارید بعد از باخت، استیک را برای جبران بالا ببرید (چیس کردن) — این تنها خطایی است که حساب‌ها را نابود می‌کند.",
    tipFa:
      "نکته حرفه‌ای: بانک را از حساب شخصی زندگی جدا نگه دارید و رکورد روزانه همه شرط‌ها را با زمان و ضریب ثبت کنید؛ بدون دفتر رکورد، هیچ پیشرفتی قابل سنجش نیست.",
  },
  {
    index: 9,
    term: "IMPLIED PROBABILITY",
    phonetic: "/im-plyd pro-buh-bil-uh-tee/",
    category: "CORE MATH",
    definition:
      "THE HIDDEN WIN CHANCE INSIDE AN ODD: 1 / ODDS. A PRICE OF 2.00 MEANS THE MARKET BELIEVES THE OUTCOME HITS 50% OF THE TIME.",
    example: "ODDS 1.97 - IMPLIED PROBABILITY 1/1.97 = 50.8% BEFORE MARGIN ADJUSTMENT.",
    explanationFa:
      "احتمال ضمنی (Implied Probability) زبان مشترک ضرایب و احتمال است: کافی است عدد یک را بر ضریب تقسیم کنید. ضریب ۲٫۰۰ یعنی بازار آن نتیجه را ۵۰ درصد می‌داند؛ ضریب ۴٫۰۰ یعنی ۲۵ درصد. نکته مهم این است که ضرایب برندها شامل حاشیه سود (Margin) است، پس احتمال ضمنی واقعی کمی بالاتر از این فرمول ساده است. کل سیستم ما بر همین پایه بنا شده است: مدل مارکوف احتمال واقعی را می‌سازد و آن را با احتمال ضمنی بازار مقایسه می‌کند تا فقط جایی که مدل از بازار مطمئن‌تر است کارت صادر شود.",
    tipFa:
      "نکته حرفه‌ای: هر بار که ضریب یک پیک را می‌بینید، سریع تقسیم کنید: 1÷ضریب. اگر عدد مدل شما به‌طور معنادار بالاتر از این مقدار بود، آن شرط ارزش (Value) دارد.",
  },
  {
    index: 10,
    term: "VALUE BET & EV",
    phonetic: "/val-yoo bet and ee-vee/",
    category: "CORE MATH",
    definition:
      "A VALUE BET EXISTS WHEN YOUR PROBABILITY BEATS THE IMPLIED PROBABILITY. EV = (PROB X ODDS) - 1; POSITIVE EV IS THE ONLY REASON TO BET.",
    example: "YOUR PROB 55% AT ODDS 2.10: EV = 0.55 X 2.10 - 1 = +15.5% POSITIVE EDGE.",
    explanationFa:
      "شرط ارزش (Value Bet) جایی است که احتمال واقعی نتیجه (طبق مدل شما) از احتمال ضمنی ضریب بیشتر باشد. ارزش مورد انتظار (EV) با فرمول احتمال ضربدر ضریب منهای یک محاسبه می‌شود؛ اگر مثبت باشد، در بلندمدت این شرط سودده است حتی اگر آن بازی خاص با شود. سیستم ما هیچ کارتی را بدون EV مثبت مدل صادر نمی‌کند و همین نکته تفاوت اصلی شرط‌بندی تحلیلی با حدس زدن است. یادتان باشد ارزش بلندمدت است، نه تضمین تک‌بازی.",
    tipFa:
      "نکته حرفه‌ای: فقط از یک منبع احتمال استفاده کنید و آن را مداوم به‌روز نگه دارید؛ مخلوط کردن چند مدل بدون هماهنگی، EV را غیرقابل اعتماد می‌کند.",
  },
  {
    index: 11,
    term: "DUTCHING",
    phonetic: "/duh-ching/",
    category: "STRATEGY",
    definition:
      "SPLITTING ONE BANK ACROSS TWO (OR MORE) COMPLEMENTARY OUTCOMES SO THE PROFIT IS IDENTICAL NO MATTER WHICH LEG WINS.",
    example: "STAKE 52U AT 1.97 + 48U AT 2.68 - EITHER WIN RETURNS ROUGHLY THE SAME PROFIT.",
    explanationFa:
      "داتشینگ (Dutching) یعنی تقسیم استیک بین دو یا چند نتیجه مکمل به‌گونه‌ای که در هر کدام برنده شود سود یکسانی بگیرید. سهم هر لگ از معکوس ضریب آن محاسبه می‌شود: هرچه ضریب بالاتر، سهم کمتر. سیستم دوپایی ما (تیپ A و تیپ B) دقیقاً همین روش است؛ دو بازار استاندارد و مکمل که با هم تقریباً تمام مسیرهای برد بازی را پوشش می‌دهند و هر کدام به تنهایی هم یک شرط ساده و قابل قبول است. تفاوت اصلی با پارلی این است که در داتشینگ هر دو لگ باید در بازی واحد باشند و ضرایب مستقل می‌مانند.",
    tipFa:
      "نکته حرفه‌ای: مجموع معکوس ضرایب (1/ضریب‌ها) را همیشه چک کنید؛ اگر از ۱ بالاتر رود یعنی هیچ ترکیبی سود یکسان نمی‌دهد و ساختار دوپایی از دست رفته است.",
  },
  {
    index: 12,
    term: "CASH OUT",
    phonetic: "/kash owt/",
    category: "STRATEGY",
    definition:
      "SETTLING YOUR BET EARLY AT A LIVE PRICE. LOCKS PROFIT ON WINNING TICKETS OR CUTS LOSS WHEN THE MATCH TURNS AGAINST YOU.",
    example: "A 2.00 TICKET LEADING AT 70' OFFERS ~1.45 CASH OUT - LESS THAN FULL WIN, GUARANTEED.",
    explanationFa:
      "کش‌اوت (Cash Out) امکان تسویه زودتر از پایان بازی است. برندها بر اساس وضعیت لحظه‌ای بازی و احتمال باقی‌مانده یک قیمت زنده پیشنهاد می‌دهند که معمولاً کمتر از سود کامل است اما ریسک باخت را صفر می‌کند. کش‌اوت ابزار مدیریت ریسک است نه ابزار سود؛ استفاده منظم از آن در بلندمدت مقدار زیادی ارزش از دست می‌دهد چون قیمت پیشنهادی برندها همیشه با حاشیه سود خودشان است. فقط در دو حالت منطقی است: وقتی اطلاعات جدید (مثل مصداح ستاره) وضعیت را برعکس کرده، یا وقتی به مدیریت روانی و قفل سود نیاز دارید.",
    tipFa:
      "نکته حرفه‌ای: اگر مدل شما به نتایج پایانی اعتماد دارد، کش‌اوت خودکار (Auto Cash Out) را فقط برای حفاظت از سودهای بزرگ تنظیم کنید، نه برای هر برد کوچک.",
  },
  {
    index: 13,
    term: "IN-PLAY / LIVE BETTING",
    phonetic: "/in-play liv bet-ing/",
    category: "STRATEGY",
    definition:
      "BETTING WHILE THE MATCH RUNS. PRICES REPRICE EVERY POINT OR GOAL AND DISCIPLINE MATTERS MORE THAN ANY PRE-MATCH EDGE.",
    example: "A FAVORITE DOWN A SET TYPICALLY DRIFTS FROM 1.50 TO 2.60 BEFORE SET TWO STARTS.",
    explanationFa:
      "شرط‌بندی زنده (In-Play) یعنی شرط دادن در حین بازی؛ ضرایب با هر گیم، گل و رویداد به‌صورت لحظه‌ای باز‌قیمت‌گذاری می‌شوند. این بازار فرصت‌های خاصی می‌سازد — مثلاً اگر تیم برتر با اختلاف کم عقب افتاده باشد و آمار نشان دهد برگشت‌پذیر است، ضریب متورم شده ارزش مثبت می‌گیرد. اما خطر اصلی آن تصمیم‌گیری هیجانی است؛ بدون مدل و بدون حد از قبل تعیین‌شده، بازار زنده سریع‌تر از تفکر شما پول می‌برد. سیستم ما تایمینگ هر کارت را با برچسب‌های T-30M یا IN-PLAY مشخص می‌کند تا ورود زنده فقط طبق طرح انجام شود.",
    tipFa:
      "نکته حرفه‌ای: قبل از شروع بازی، برای خودتان دو سناریوی ورود زنده (قیمت و زمان دقیق) بنویسید؛ اگر هیچ‌کدام فعال نشد، یعنی آن بازی اساساً نباید شرط زنده می‌گرفت.",
  },
  {
    index: 14,
    term: "VETO & DISCIPLINE",
    phonetic: "/vee-toh and dis-i-plin/",
    category: "SUPERVISOR RULES",
    definition:
      "THE GATE THAT KILLS A PICK BEFORE IT EXISTS: OUTSIDE THE MODEL DOMAIN OR BELOW THE RISK CEILING MEANS NO CARD IS PUBLISHED AT ALL.",
    example: "MATCH WITH A RANKED #140 PLAYER IS AUTO-VETOED - THE MODEL ONLY TRUSTS TOP-100 DATA.",
    explanationFa:
      "وتو (Veto) قلب انضباط سیستم ماست: سوپروایزر قبل از انتشار هر کارت، سه دروازه را چک می‌کند — داخل دامنه دقت مدل بودن (تاپ-۱۰۰ رنکینگ رسمی)، وجود حداقل یک الگوی مکمل با ریسک زیر سقف، و گذشتن از سقف ریسک هم‌زمان. اگر هیچ‌کدام پاس نشود، بازی به دفتر سایه می‌رود و هیچ کارتی چاپ نمی‌شود؛ حتی اگر ضریب وسوسه‌کننده باشد. شفافیت وتوها یعنی ما هر روز تعداد و دلیل بازی‌های ردشده را اعلام می‌کنیم — چون حرفه‌ای بودن فقط برندها را نشان دادن نیست، بایدها را هم نشان دادن است. حافظه بلندمدت شما بهتر از هر پیش‌بینی‌ای عمل می‌کند وقتی بدانید چه زمانی نباید بازی کرد.",
    tipFa:
      "نکته حرفه‌ای: روزی که هیچ کارتی صادر نمی‌شود بهترین فرصت یادگیری است؛ به دفتر سایه نگاه کنید و ببینید مدل دقیقاً کجا توقف کرد — این همان مرزی است که حساب شما را زنده نگه می‌دارد.",
  },
];

/** Advance the rotation cursor: one new lesson per AM slot (1..14 wrapping). */
export function nextLessonIndex(current?: string | null): number {
  const cur = Number(current ?? "0");
  return (cur % ACADEMY.length) + 1;
}
