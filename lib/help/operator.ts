import type { HelpDocs } from "./types";

/** Operator guide. Both languages keep the same section ids and block order (tests/help.test.mjs). */
export const operatorHelp: HelpDocs = {
  uk: {
    title: "Довідка оператора",
    lead: "Усе, що потрібно знати оператору: як увійти, заповнити картку обробки, додати документи, надіслати її на перевірку й отримати публічний сертифікат з QR-кодом. Технічних знань не потрібно.",
    parts: [
      {
        title: "Початок роботи",
        sections: [
          {
            id: "about",
            title: "Що таке Hartolit Field Passport",
            blocks: [
              { p: "Hartolit Field Passport — це **цифровий паспорт обробки поля**. Ви записуєте, яке поле, коли, чим і за яких умов обробили. Адміністратор Hartolit перевіряє запис. Після перевірки публічна частина запису фіксується назавжди, і будь-хто (покупець урожаю, інспектор, партнер) може відсканувати QR-код і переконатися, що дані справжні й ніхто їх не змінював." },
              { note: "Уявіть довідку, завірену нотаріусом: печатка й запис у реєстрі, який неможливо переписати. Якщо хтось змінить у довідці хоч одну цифру, звірка з реєстром одразу це покаже. Hartolit робить те саме, тільки цифрово.", tone: "tip" },
              { h: "Ваше завдання як оператора" },
              { ul: [
                "точно заповнити картку обробки;",
                "додати підтвердні документи: метеодані та документ щодо препарату;",
                "надіслати картку на перевірку й за потреби виправити її за приміткою адміністратора.",
              ] },
              { p: "Публікацію виконує не оператор, а уповноважений адміністратор Hartolit. Ви бачите результат у списку **«Мої надіслані паспорти»**." },
            ],
          },
          {
            id: "roles",
            title: "Хто що робить",
            blocks: [
              { table: { head: ["Роль", "Хто це", "Що робить"], rows: [
                ["**Оператор** (ви)", "агроном, пілот дрона, працівник господарства", "заповнює картку, додає документи, надсилає на перевірку"],
                ["**Адміністратор**", "працівник Hartolit", "запрошує операторів, перевіряє картки, схвалює або повертає на виправлення"],
                ["**Видавець**", "один призначений адміністратор зі службовим гаманцем", "публікує схвалені дані й випускає сертифікат у блокчейні"],
                ["**Будь-хто ззовні**", "покупець, інспектор, партнер", "сканує QR-код і бачить результат перевірки без входу в систему"],
              ] } },
              { note: "Оператор не може нічого опублікувати самостійно. Публікація можлива лише після перевірки адміністратором.", tone: "info" },
            ],
          },
          {
            id: "requirements",
            title: "Що потрібно для роботи",
            blocks: [
              { h: "Технічно" },
              { ul: [
                "комп'ютер, планшет або телефон із сучасним браузером (Chrome, Edge, Firefox, Safari);",
                "запрошення від адміністратора Hartolit на вашу електронну пошту;",
                "бажано — застосунок-автентифікатор на телефоні (Google Authenticator, Microsoft Authenticator, 1Password тощо) для двофакторного входу.",
              ] },
              { p: "Гаманець, криптовалюта чи знання блокчейну оператору **не потрібні**." },
              { h: "Дані, які варто мати під рукою" },
              { table: { head: ["Що", "Приклад"], rows: [
                ["назва господарства (юридична) і окремо публічна назва", "ТОВ «Степ-Агро» / «Степ-Агро, Полтавщина»"],
                ["площа поля і фактично оброблена площа", "56.2 га / 48 га"],
                ["культура і тип обробки", "соняшник, гербіцидна обробка"],
                ["дата, час початку і часовий пояс", "20.10.2026, 09:30, Europe/Kyiv"],
                ["модель дрона та ПІБ оператора дрона", "DJI Agras T40, Петренко Іван Олегович"],
                ["погода: температура, вологість, вітер, опади, час вимірювання (UTC)", "14.5 °C, 62 %, 2.5 м/с, 0 мм, 06:00 UTC"],
                ["препарат, діюча речовина, доза, одиниця, робочий об'єм", "«Раундап Макс», гліфосат 450 г/л, 3.0 л/га, 50 л/га"],
                ["файл метеоданих", "експорт із метеостанції (CSV, JSON, TXT, PDF)"],
                ["документ щодо препарату", "накладна, рахунок-фактура або акт (PDF чи фото)"],
              ] } },
            ],
          },
          {
            id: "account",
            title: "Вхід і обліковий запис",
            blocks: [
              { h: "Перший вхід за запрошенням" },
              { ol: [
                "Адміністратор створює ваш обліковий запис. Вам приходить лист із посиланням для встановлення пароля.",
                "Відкрийте посилання й задайте пароль **від 12 символів**. Посилання діє **1 годину**.",
                "Увійдіть на сторінці входу з поштою та новим паролем.",
              ] },
              { note: "Посилання прострочилося? На сторінці входу натисніть **«Забули пароль?»**, введіть пошту й отримайте нове посилання.", tone: "tip" },
              { h: "Звичайний вхід і безпека" },
              { ul: [
                "Сеанс триває до **8 годин** без активності, потім потрібно увійти знову.",
                "Після **5 невдалих спроб входу за 15 хвилин** вхід тимчасово блокується. Зачекайте 15 хвилин.",
                "Запит на скидання пароля можна надіслати не частіше ніж 3 рази за 15 хвилин.",
                "Мова інтерфейсу перемикається кнопками **UK / EN** у шапці. Вибір запам'ятовується в цьому браузері.",
              ] },
              { h: "Двофакторний вхід (рекомендовано)" },
              { p: "На сторінці [Безпека облікового запису](/settings/security) натисніть «Увімкнути двофакторну автентифікацію», підтвердьте пароль, відскануйте QR-код застосунком-автентифікатором і введіть шестизначний код. Після цього вхід вимагатиме і пароль, і код із телефона." },
              { note: "Після ввімкнення система покаже **резервні коди**. Збережіть їх у менеджері паролів одразу: повторно їх не покажуть. Кожен код працює один раз і рятує, якщо телефон загублено.", tone: "warn" },
              { p: "Загубили телефон? На сторінці введення коду натисніть «Використати резервний код», увійдіть і на сторінці безпеки виберіть **«Замінити автентифікатор»**. Там же є кнопка **«Вийти з інших пристроїв»**." },
            ],
          },
        ],
      },
      {
        title: "Паспорт крок за кроком",
        sections: [
          {
            id: "lifecycle",
            title: "Шлях паспорта: від чернетки до сертифіката",
            blocks: [
              { ol: [
                "**Чернетка.** Ви створюєте й заповнюєте картку. Вона зберігається автоматично.",
                "**Докази.** Додаєте метеофайл і документ щодо препарату. Антивірус перевіряє кожен файл.",
                "**Надіслано.** Ви надсилаєте картку на перевірку. Змінювати її вже не можна.",
                "**Перевірка.** Адміністратор схвалює картку, відхиляє її або просить змін.",
                "**Публікація.** Видавець фіксує публічну частину в IPFS і в блокчейні.",
                "**Опубліковано.** З'являється публічна сторінка з QR-кодом.",
              ] },
              { h: "Статуси, які ви бачите" },
              { table: { head: ["Статус", "Що означає", "Що робити"], rows: [
                ["Чернетка", "картку ще не надіслано", "заповнюйте й додавайте докази"],
                ["Надіслано", "картка чекає перевірки", "нічого, очікуйте"],
                ["Потрібні зміни", "адміністратор просить виправити", "прочитайте примітку, натисніть «Відкрити для редагування», виправте й надішліть знову"],
                ["Відхилено", "картку не прийнято", "прочитайте причину; за потреби відкрийте для редагування й надішліть знову"],
                ["Схвалено", "перевірку пройдено", "нічого, далі працює видавець"],
                ["Публікуємо", "триває публікація", "нічого, очікуйте"],
                ["Опубліковано", "сертифікат видано", "відкрийте публічну сторінку за позначкою «Видано · токен #…»"],
                ["Помилка публікації", "публікація не вдалася", "нічого, адміністратор розбереться; ваші дані збережено"],
              ] } },
            ],
          },
          {
            id: "drafts",
            title: "Чернетки та автоматичне збереження",
            blocks: [
              { p: "На головній сторінці є блок **«Чернетки паспортів»**. Кнопка **«Нова чернетка»** створює порожню картку, а список **«Вибрати чернетку»** відкриває наявну. Одна чернетка — одна обробка одного поля." },
              { p: "Зміни зберігаються автоматично приблизно через секунду після того, як ви перестали вводити. Рядок стану під заголовком показує, що відбувається:" },
              { table: { head: ["Напис", "Що означає"], rows: [
                ["Зберігаємо…", "зміни саме надсилаються на сервер"],
                ["Збережено в обліковому записі", "усе на сервері, можна закривати сторінку"],
                ["Незбережені зміни у цій вкладці", "зміни є лише в цій вкладці браузера; вони переживуть перезавантаження, але не закриття вкладки"],
                ["Деякі значення потрібно виправити…", "якесь поле має неприпустиме значення; поки ви його не виправите, нічого не зберігається"],
                ["Не вдалося зберегти зміни", "немає зв'язку або сервер недоступний; натисніть «Спробувати знову»"],
                ["Чернетку змінено в іншому сеансі", "ту саму чернетку змінили в іншій вкладці чи на іншому пристрої"],
              ] } },
              { p: "Якщо чернетку змінено в іншому сеансі, виберіть: **«Завантажити версію із сервера»** (ваші останні зміни в цій вкладці буде відкинуто) або **«Залишити мої зміни»** (ваша версія замінить серверну)." },
              { note: "Пропав інтернет — не закривайте вкладку. Коли зв'язок повернеться, натисніть «Спробувати знову»: зміни, що лишилися у вкладці, буде збережено.", tone: "tip" },
            ],
          },
          {
            id: "form",
            title: "Заповнення картки: поле за полем",
            blocks: [
              { p: "Картка має чотири розділи. Стовпець **«Публічне»** показує, чи потрапить значення на публічну сторінку сертифіката. Усе інше бачать лише адміністратори Hartolit." },
              { h: "1. Фермер та поле" },
              { table: { head: ["Поле", "Обов'язкове", "Публічне", "Підказка"], rows: [
                ["Назва ФГ або ПІБ фермера", "так", "ні", "юридична назва, як у документах"],
                ["Публічна назва господарства", "так", "**так**", "назва, яку побачать усі; не пишіть тут ПІБ, телефони чи адреси"],
                ["ЄДРПОУ / ІПН", "ні", "ні", ""],
                ["Площа поля (га)", "так", "**так**", "наприклад 56.2"],
                ["GPS координати", "ні", "ні", "центр поля у форматі «широта, довгота»"],
                ["Кадастровий номер", "ні", "ні", ""],
                ["Культура", "так", "**так**", "вибір зі списку"],
                ["Публічний код поля", "—", "**так**", "система призначає сама; змінювати не потрібно"],
              ] } },
              { h: "2. Обробка та дрон" },
              { table: { head: ["Поле", "Обов'язкове", "Публічне", "Підказка"], rows: [
                ["Тип обробки", "так", "**так**", "гербіцидна, фунгіцидна, інсектицидна, добрива, десикація, інше"],
                ["Дата обробки", "так", "**так**", ""],
                ["Час початку", "так", "**так**", "місцевий час"],
                ["Часовий пояс обробки", "так", "**так**", "для України зазвичай `Europe/Kyiv`"],
                ["Оброблена площа (га)", "так", "**так**", "лише фактично оброблена; **не більша** за площу поля"],
                ["Модель дрона", "так", "**так**", "наприклад DJI Agras T40"],
                ["Серійний номер", "ні", "ні", ""],
                ["Оператор (ПІБ)", "так", "ні", "хто керував дроном"],
                ["Ліцензія DARS", "ні", "ні", "категорія A2/A3"],
                ["Примітки оператора", "ні", "ні", "умови польоту, особливості ділянки"],
              ] } },
              { h: "3. Метеодані" },
              { table: { head: ["Поле", "Обов'язкове", "Публічне", "Підказка"], rows: [
                ["Температура, вологість, вітер, опади", "так", "**так**", "числа з метеостанції"],
                ["Час вимірювання погоди (UTC)", "так", "**так**", "час із джерела вимірювання; не підставляйте час обробки, якщо вимір був в інший час"],
              ] } },
              { h: "4. Хімія та постачальник" },
              { table: { head: ["Поле", "Обов'язкове", "Публічне", "Підказка"], rows: [
                ["Назва препарату", "так", "**так**", ""],
                ["Діюча речовина", "ні", "**так**", "наприклад «Гліфосат, 450 г/л»"],
                ["Доза та одиниця дози", "так", "**так**", "л/га для рідин, кг/га для твердих речовин"],
                ["Робочий об'єм (л/га)", "так", "**так**", ""],
                ["Виробник", "ні", "**так**", ""],
                ["№ реєстрації (Укрпестицид)", "ні", "**так**", ""],
                ["Постачальник та його ЄДРПОУ", "ні", "ні", ""],
              ] } },
              { example: "правильно заповнена обробка", lines: [
                "Поле 56.2 га, соняшник. Гербіцидна обробка 20.10.2026 о 09:30, Europe/Kyiv, оброблено 48 га дроном DJI Agras T40.",
                "Погода: 14.5 °C, вологість 62 %, вітер 2.5 м/с, без опадів, виміряно о 06:00 UTC (тобто о 09:00 за Києвом).",
                "Препарат «Раундап Макс», 3.0 л/га, робочий розчин 50 л/га.",
              ] },
              { note: "Оброблена площа не може перевищувати площу поля: система не прийме таку картку. Перевірте одиниці дози: «3 кг/га» замість «3 л/га» — це вже інші дані.", tone: "warn" },
            ],
          },
          {
            id: "evidence",
            title: "Докази: документи до картки",
            blocks: [
              { p: "Під формою є розділ **«Приватні докази»**. Для надсилання потрібні щонайменше два перевірені файли: **метеодані** і **документ щодо препарату**. Можна додати й інші підтвердні файли." },
              { ol: [
                "Виберіть **тип доказу**: «Метеодані», «Документ щодо препарату» чи «Інший підтвердний файл».",
                "Натисніть **«Оберіть файл»**. Підходять PDF, PNG, JPEG, JSON, CSV, TXT або XML **до 10 МБ**.",
                "Натисніть **«Завантажити доказ»** і дочекайтеся статусу **«Перевірено»**.",
              ] },
              { table: { head: ["Статус файлу", "Що означає"], rows: [
                ["Очікує завантаження", "файл ще не завантажено до кінця"],
                ["Перевіряємо", "антивірус перевіряє файл"],
                ["Перевірено", "файл прийнято, його можна використати"],
                ["Очікує перевірки", "перевірку не вдалося завершити; натисніть «Повторити перевірку»"],
                ["Відхилено", "файл не пройшов перевірку (наприклад, виявлено вірус); видаліть його й завантажте інший"],
              ] } },
              { note: "Незавершений файл блокує надсилання картки. Якщо завантаження обірвалося, натисніть «Повторити перевірку» або **«Видалити»** і завантажте файл знову.", tone: "warn" },
              { p: "Самі файли **ніколи не публікуються**. На публічній сторінці з'являється лише їхній цифровий відбиток (SHA-256): він доводить, що документ не підмінили, але не розкриває його вмісту." },
            ],
          },
          {
            id: "submit",
            title: "Надсилання на перевірку",
            blocks: [
              { p: "Коли все заповнено, натисніть **«Надіслати на перевірку»**. Якщо чогось бракує, система покаже список **«Перед надсиланням заповніть:»** з конкретними полями." },
              { h: "Що потрібно, щоб отримати сертифікат" },
              { ul: [
                "заповнені всі обов'язкові поля чотирьох розділів;",
                "оброблена площа не більша за площу поля;",
                "щонайменше один **перевірений** метеофайл і один **перевірений** документ щодо препарату;",
                "жодного незавершеного чи відхиленого файлу;",
                "схвалення адміністратора й публікація видавцем (це вже робить Hartolit).",
              ] },
              { note: "Після надсилання картку й докази заморожено: змінити їх не можна, доки адміністратор не поверне картку на виправлення.", tone: "info" },
            ],
          },
          {
            id: "after-review",
            title: "Після перевірки: виправлення та повторне надсилання",
            blocks: [
              { p: "Стан ваших карток показує блок **«Мої надіслані паспорти»**. Натисніть **«Оновити»**, щоб побачити найсвіжіший стан. Під карткою видно примітку адміністратора, якщо вона є." },
              { ol: [
                "Статус **«Потрібні зміни»** чи **«Відхилено»** → прочитайте примітку.",
                "Натисніть **«Відкрити для редагування»**. Картка знову стає чернеткою, а примітка показується як «Попередня примітка перевірки».",
                "Виправте дані чи докази й надішліть картку знову.",
              ] },
              { example: "примітка адміністратора", lines: [
                "«Оброблена площа 60 га більша за площу поля 56.2 га. Перевірте площу за картою польоту.»",
                "Ви відкриваєте картку, змінюєте оброблену площу на 48 га й надсилаєте знову.",
              ] },
            ],
          },
          {
            id: "certificate",
            title: "Сертифікат і публічна сторінка",
            blocks: [
              { p: "Після публікації біля картки з'являється позначка **«Видано · токен #…»**. Вона відкриває публічну сторінку сертифіката. Цю сторінку може відкрити будь-хто, без облікового запису й без гаманця." },
              { h: "Що на публічній сторінці" },
              { ul: [
                "результат перевірки (див. таблицю нижче) і всі публічні факти обробки;",
                "посилання й **QR-код** для поширення, кнопки «Друкувати або зберегти як PDF» і «Завантажити публічний документ (JSON)»;",
                "дані блокчейну: контракт, власник токена, кількість підтверджень.",
              ] },
              { table: { head: ["Що показує сторінка", "Що це означає"], rows: [
                ["**Перевірено**", "дані точно ті, що зафіксовані в блокчейні"],
                ["**Очікує**", "запис щойно опубліковано; перевірте за хвилину"],
                ["**Недоступно**", "мережа тимчасово не відповідає; це не висновок щодо запису"],
                ["**Не підтверджено**", "дані не збігаються з блокчейном; на запис покладатися не можна"],
              ] } },
              { h: "Що публічне, а що ні" },
              { table: { head: ["Публічне (бачать усі)", "Приватне (лише адміністратори Hartolit)"], rows: [
                ["публічна назва господарства, публічний код поля, площа, культура", "юридична назва, ЄДРПОУ/ІПН, GPS, кадастровий номер"],
                ["тип, дата, час, часовий пояс, оброблена площа, модель дрона", "ПІБ оператора, ліцензія, серійний номер дрона, примітки"],
                ["погода і час вимірювання", "ваша пошта та облікові дані"],
                ["препарат, діюча речовина, доза, робочий об'єм, виробник, № реєстрації", "постачальник та його ЄДРПОУ"],
                ["відбитки (SHA-256) метеофайлу і документа щодо препарату", "самі файли"],
              ] } },
              { note: "Сертифікат доводить лише те, що опубліковані дані не змінювалися. Він не доводить, що обробка була правильною чи дає право на компенсацію.", tone: "info" },
              { note: "Поки сервіс працює в тестовій мережі (BSC Testnet), сторінка позначає записи як пілотні: це ще не робочі сертифікати.", tone: "info" },
            ],
          },
          {
            id: "corrections",
            title: "Помилка в уже опублікованому сертифікаті",
            blocks: [
              { p: "Опублікований сертифікат змінити неможливо, і так задумано. Якщо в ньому помилка, повідомте адміністратора. Він відкриє **виправлення**:" },
              { ol: [
                "У вашому списку чернеток з'являється копія картки з позначкою **«Виправлення сертифіката»**.",
                "Виправте дані й **завантажте докази знову**: вони не копіюються.",
                "Надішліть картку на перевірку, як звичайно.",
                "Після публікації виправлення стара публічна сторінка показує, що її замінено, і дає посилання на новий сертифікат.",
              ] },
              { note: "Поки виправлення не опубліковано, стара сторінка попереджає, що виправлення триває.", tone: "info" },
            ],
          },
        ],
      },
      {
        title: "Довідкове",
        sections: [
          {
            id: "privacy",
            title: "Приватність і безпека",
            blocks: [
              { ul: [
                "Нікому не повідомляйте пароль, коди з автентифікатора чи резервні коди. Працівники Hartolit їх **ніколи** не просять.",
                "У публічну назву господарства не пишіть ПІБ, телефони, адреси, номери документів.",
                "Не залишайте особисті дані фермерів у відгуках.",
                "Працюєте на чужому комп'ютері — натисніть **«Вийти»** після роботи.",
                "Отримали підозрілий лист нібито від Hartolit — не переходьте за посиланням, повідомте адміністратора.",
              ] },
              { note: "Усе опубліковане в IPFS та блокчейні **неможливо видалити**. Тому перевіряйте кожне значення, що позначене як публічне.", tone: "warn" },
            ],
          },
          {
            id: "retention",
            title: "Скільки зберігаються дані",
            blocks: [
              { ul: [
                "Надіслані, перевірені й опубліковані картки автоматично не видаляються.",
                "Чернетку, яку **жодного разу не надсилали** і не змінювали **90 днів**, можуть видалити. Спершу вам прийде лист.",
                "Видалення можливе не раніше ніж через **30 днів після листа** і лише якщо чернетку так і не змінили. Будь-яка зміна скасовує видалення.",
                "Публічні дані опублікованого сертифіката лишаються доступними назавжди.",
              ] },
            ],
          },
          {
            id: "feedback",
            title: "Відгук про застосунок",
            blocks: [
              { p: "Унизу головної сторінки є посилання **«Залишити відгук»**. Оцініть зручність від 1 до 5 і напишіть, що покращити (від 10 до 2000 символів). Відгук бачать лише адміністратори. Можна надіслати до 5 відгуків за годину." },
              { p: "Пишіть конкретно: «на телефоні кнопка „Надіслати“ ховається під клавіатурою» корисніше, ніж «незручно»." },
            ],
          },
          {
            id: "faq",
            title: "Часті питання та проблеми",
            blocks: [
              { qa: [
                ["Не приходить лист-запрошення чи лист для скидання пароля.", "Перевірте папку «Спам». Посилання діє 1 годину. Якщо листа немає, попросіть адміністратора перевірити адресу або скористайтеся «Забули пароль?» на сторінці входу."],
                ["Пише «Не вдалося увійти», хоча пароль правильний.", "Можливо, вичерпано 5 спроб за 15 хвилин. Зачекайте 15 хвилин. Якщо доступ вимкнено адміністратором, вхід неможливий: зверніться до нього."],
                ["Загубив телефон з автентифікатором.", "Увійдіть резервним кодом («Використати резервний код») і замініть автентифікатор на сторінці безпеки. Якщо кодів немає, зверніться до адміністратора."],
                ["Кнопка «Надіслати на перевірку» показує список незаповнених полів.", "Заповніть кожне поле зі списку. Найчастіше бракує перевіреного метеофайлу чи документа щодо препарату або лишився незавершений файл."],
                ["Файл завис на «Перевіряємо» чи «Очікує перевірки».", "Натисніть «Повторити перевірку». Не допомогло — видаліть файл і завантажте знову. Перевірте розмір (до 10 МБ) і формат."],
                ["Файл «Відхилено».", "Антивірус чи перевірка формату не пропустили файл. Збережіть документ заново (наприклад, як PDF) і завантажте ще раз."],
                ["Хочу змінити вже надіслану картку.", "Поки картка на перевірці, змінити її не можна. Попросіть адміністратора повернути її на виправлення."],
                ["Публічна сторінка показує «Недоступно».", "Тимчасово не відповідає мережа. Це не означає, що з сертифікатом щось не так. Спробуйте пізніше."],
                ["Публічна сторінка показує «Не підтверджено».", "Негайно повідомте адміністратора Hartolit і не використовуйте цей сертифікат, поки ситуацію не з'ясують."],
              ] },
            ],
          },
          {
            id: "glossary",
            title: "Словничок",
            blocks: [
              { table: { head: ["Слово", "Простими словами"], rows: [
                ["Блокчейн", "публічний реєстр, у якому неможливо переписати минуле"],
                ["Відбиток (хеш, SHA-256)", "«відбиток пальця» тексту чи файлу: змініть одну літеру — відбиток стане іншим"],
                ["Двофакторний вхід (2FA, MFA)", "вхід із паролем і кодом із телефона"],
                ["Доказ", "приватний файл, що підтверджує дані картки"],
                ["IPFS", "мережа зберігання, де документ шукають за його відбитком"],
                ["QR-код", "квадратний код, який телефон відкриває як посилання на публічну сторінку"],
                ["Testnet", "тестова мережа блокчейну для пілоту, без справжніх грошей"],
                ["Токен", "номер сертифіката в блокчейні, наприклад #1"],
                ["Чернетка", "картка, яку ще не надіслано на перевірку"],
              ] } },
            ],
          },
        ],
      },
    ],
  },
  en: {
    title: "Operator guide",
    lead: "Everything an operator needs: how to sign in, fill in a treatment record, add documents, send it for review and get a public certificate with a QR code. No technical knowledge is needed.",
    parts: [
      {
        title: "Getting started",
        sections: [
          {
            id: "about",
            title: "What Hartolit Field Passport is",
            blocks: [
              { p: "Hartolit Field Passport is a **digital passport of a field treatment**. You record which field was treated, when, with what and in which conditions. A Hartolit administrator reviews the record. After review, the public part of the record is fixed for good, and anyone (a crop buyer, an inspector, a partner) can scan the QR code and confirm the data is genuine and unchanged." },
              { note: "Think of a notarised certificate: a seal and an entry in a register nobody can rewrite. If someone changes a single digit, comparing it with the register shows it at once. Hartolit does the same, digitally.", tone: "tip" },
              { h: "Your job as an operator" },
              { ul: [
                "fill in the treatment record accurately;",
                "add supporting documents: weather data and a document for the product;",
                "send the record for review and, if asked, fix it according to the administrator's note.",
              ] },
              { p: "Publishing is done not by the operator but by an authorised Hartolit administrator. You see the result under **My submitted passports**." },
            ],
          },
          {
            id: "roles",
            title: "Who does what",
            blocks: [
              { table: { head: ["Role", "Who", "What they do"], rows: [
                ["**Operator** (you)", "agronomist, drone pilot, farm worker", "fills in the record, adds documents, sends it for review"],
                ["**Administrator**", "Hartolit staff", "invites operators, reviews records, approves or returns them for changes"],
                ["**Publisher**", "one designated administrator with the service wallet", "publishes approved data and issues the certificate on the blockchain"],
                ["**Anyone outside**", "buyer, inspector, partner", "scans the QR code and sees the verification result without signing in"],
              ] } },
              { note: "An operator cannot publish anything alone. Publication is only possible after an administrator's review.", tone: "info" },
            ],
          },
          {
            id: "requirements",
            title: "What you need",
            blocks: [
              { h: "Technically" },
              { ul: [
                "a computer, tablet or phone with a modern browser (Chrome, Edge, Firefox, Safari);",
                "an invitation from a Hartolit administrator to your email;",
                "ideally, an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and so on) for two-step sign-in.",
              ] },
              { p: "Operators do **not** need a wallet, cryptocurrency or blockchain knowledge." },
              { h: "Data to have at hand" },
              { table: { head: ["What", "Example"], rows: [
                ["farm name (legal) and, separately, a public name", "Step-Agro LLC / “Step-Agro, Poltava region”"],
                ["field area and the area actually treated", "56.2 ha / 48 ha"],
                ["crop and treatment type", "sunflower, herbicide treatment"],
                ["date, start time and time zone", "2026-10-20, 09:30, Europe/Kyiv"],
                ["drone model and the drone operator's full name", "DJI Agras T40, Ivan Petrenko"],
                ["weather: temperature, humidity, wind, rainfall, measurement time (UTC)", "14.5 °C, 62 %, 2.5 m/s, 0 mm, 06:00 UTC"],
                ["product, active substance, dose, unit, working volume", "“Roundup Max”, glyphosate 450 g/l, 3.0 l/ha, 50 l/ha"],
                ["weather data file", "export from the weather station (CSV, JSON, TXT, PDF)"],
                ["product document", "delivery note, invoice or certificate (PDF or photo)"],
              ] } },
            ],
          },
          {
            id: "account",
            title: "Signing in and your account",
            blocks: [
              { h: "First sign-in from the invitation" },
              { ol: [
                "An administrator creates your account. You receive an email with a link to set your password.",
                "Open the link and choose a password of **at least 12 characters**. The link is valid for **1 hour**.",
                "Sign in on the sign-in page with your email and the new password.",
              ] },
              { note: "Link expired? On the sign-in page choose **Forgot password?**, enter your email and get a new link.", tone: "tip" },
              { h: "Everyday sign-in and safety" },
              { ul: [
                "A session lasts up to **8 hours** without activity; then you sign in again.",
                "After **5 failed sign-ins within 15 minutes** sign-in is blocked for a while. Wait 15 minutes.",
                "A password reset can be requested at most 3 times in 15 minutes.",
                "Switch the interface language with **UK / EN** in the header. The choice is remembered in this browser.",
              ] },
              { h: "Two-step sign-in (recommended)" },
              { p: "On [Account security](/settings/security) choose “Enable two-factor authentication”, confirm your password, scan the QR code with an authenticator app and enter the six-digit code. From then on, sign-in needs both the password and the code from your phone." },
              { note: "After enabling it, the app shows **recovery codes**. Save them in a password manager straight away: they are not shown again. Each code works once and saves you if the phone is lost.", tone: "warn" },
              { p: "Lost your phone? On the code page choose “Use a recovery code”, sign in and, on the security page, choose **Replace authenticator**. The same page has **Sign out other devices**." },
            ],
          },
        ],
      },
      {
        title: "The passport step by step",
        sections: [
          {
            id: "lifecycle",
            title: "The path of a passport: from draft to certificate",
            blocks: [
              { ol: [
                "**Draft.** You create and fill in the record. It is saved automatically.",
                "**Evidence.** You add a weather file and a product document. An antivirus checks every file.",
                "**Submitted.** You send the record for review. It can no longer be changed.",
                "**Review.** An administrator approves it, rejects it or asks for changes.",
                "**Publication.** The publisher fixes the public part in IPFS and on the blockchain.",
                "**Published.** A public page with a QR code appears.",
              ] },
              { h: "Statuses you see" },
              { table: { head: ["Status", "Meaning", "What to do"], rows: [
                ["Draft", "not yet submitted", "fill in and add evidence"],
                ["Submitted", "waiting for review", "nothing, wait"],
                ["Changes requested", "the administrator asks for a fix", "read the note, choose “Reopen for editing”, fix and submit again"],
                ["Rejected", "the record was not accepted", "read the reason; if needed, reopen for editing and submit again"],
                ["Approved", "review passed", "nothing, the publisher takes over"],
                ["Publishing", "publication in progress", "nothing, wait"],
                ["Published", "the certificate is issued", "open the public page from the “Issued · token #…” mark"],
                ["Publication failed", "publication did not succeed", "nothing, an administrator will handle it; your data is kept"],
              ] } },
            ],
          },
          {
            id: "drafts",
            title: "Drafts and automatic saving",
            blocks: [
              { p: "The home page has a **Passport drafts** block. **New draft** creates an empty record and **Choose a draft** opens an existing one. One draft is one treatment of one field." },
              { p: "Changes save automatically about a second after you stop typing. The status line under the heading shows what is happening:" },
              { table: { head: ["Message", "Meaning"], rows: [
                ["Saving…", "changes are being sent to the server"],
                ["Saved to your account", "everything is on the server; you can close the page"],
                ["Unsaved changes in this tab", "changes exist only in this browser tab; they survive a reload but not closing the tab"],
                ["Some values need correction…", "a field has an invalid value; nothing is saved until you fix it"],
                ["Changes could not be saved", "no connection or the server is unavailable; choose “Retry save”"],
                ["This draft changed in another session", "the same draft was changed in another tab or device"],
              ] } },
              { p: "If the draft was changed in another session, choose **Load server version** (your latest changes in this tab are discarded) or **Keep my changes** (your version replaces the server one)." },
              { note: "Lost the internet? Do not close the tab. When the connection returns, choose “Retry save”: the changes kept in the tab are saved.", tone: "tip" },
            ],
          },
          {
            id: "form",
            title: "Filling in the record, field by field",
            blocks: [
              { p: "The record has four sections. The **Public** column shows whether a value appears on the public certificate page. Everything else is seen only by Hartolit administrators." },
              { h: "1. Farmer and field" },
              { table: { head: ["Field", "Required", "Public", "Hint"], rows: [
                ["Farm name or farmer's full name", "yes", "no", "legal name, as in documents"],
                ["Public farm name", "yes", "**yes**", "the name everyone sees; no personal names, phones or addresses"],
                ["EDRPOU / tax number", "no", "no", ""],
                ["Field area (ha)", "yes", "**yes**", "for example 56.2"],
                ["GPS coordinates", "no", "no", "field centre as “latitude, longitude”"],
                ["Cadastral number", "no", "no", ""],
                ["Crop", "yes", "**yes**", "chosen from the list"],
                ["Public field code", "—", "**yes**", "assigned by the system; no need to change it"],
              ] } },
              { h: "2. Treatment and drone" },
              { table: { head: ["Field", "Required", "Public", "Hint"], rows: [
                ["Treatment type", "yes", "**yes**", "herbicide, fungicide, insecticide, fertiliser, desiccation, other"],
                ["Treatment date", "yes", "**yes**", ""],
                ["Start time", "yes", "**yes**", "local time"],
                ["Treatment time zone", "yes", "**yes**", "in Ukraine usually `Europe/Kyiv`"],
                ["Treated area (ha)", "yes", "**yes**", "only the area actually treated; **not larger** than the field"],
                ["Drone model", "yes", "**yes**", "for example DJI Agras T40"],
                ["Serial number", "no", "no", ""],
                ["Operator (full name)", "yes", "no", "who flew the drone"],
                ["DARS licence", "no", "no", "category A2/A3"],
                ["Operator notes", "no", "no", "flight conditions, site specifics"],
              ] } },
              { h: "3. Weather data" },
              { table: { head: ["Field", "Required", "Public", "Hint"], rows: [
                ["Temperature, humidity, wind, rainfall", "yes", "**yes**", "numbers from the weather station"],
                ["Weather measurement time (UTC)", "yes", "**yes**", "time from the measurement source; do not use the treatment time if the reading was taken at another time"],
              ] } },
              { h: "4. Product and supplier" },
              { table: { head: ["Field", "Required", "Public", "Hint"], rows: [
                ["Product name", "yes", "**yes**", ""],
                ["Active substance", "no", "**yes**", "for example “Glyphosate, 450 g/l”"],
                ["Dose and dose unit", "yes", "**yes**", "l/ha for liquids, kg/ha for solids"],
                ["Working volume (l/ha)", "yes", "**yes**", ""],
                ["Manufacturer", "no", "**yes**", ""],
                ["Registration no. (Ukrpestytsyd)", "no", "**yes**", ""],
                ["Supplier and its EDRPOU", "no", "no", ""],
              ] } },
              { example: "a correctly filled treatment", lines: [
                "Field 56.2 ha, sunflower. Herbicide treatment on 2026-10-20 at 09:30, Europe/Kyiv, 48 ha treated with a DJI Agras T40.",
                "Weather: 14.5 °C, humidity 62 %, wind 2.5 m/s, no rain, measured at 06:00 UTC (09:00 Kyiv time).",
                "Product “Roundup Max”, 3.0 l/ha, working solution 50 l/ha.",
              ] },
              { note: "The treated area cannot exceed the field area: the system refuses such a record. Check the dose unit: “3 kg/ha” instead of “3 l/ha” is different data.", tone: "warn" },
            ],
          },
          {
            id: "evidence",
            title: "Evidence: documents for the record",
            blocks: [
              { p: "Below the form is the **Private evidence** section. Submission needs at least two verified files: **weather data** and a **product document**. You may add other supporting files too." },
              { ol: [
                "Choose the **evidence type**: “Weather record”, “Chemical document” or “Other supporting file”.",
                "Choose **Choose a file**. PDF, PNG, JPEG, JSON, CSV, TXT or XML **up to 10 MB** are accepted.",
                "Choose **Upload evidence** and wait for the **Verified** status.",
              ] },
              { table: { head: ["File status", "Meaning"], rows: [
                ["Upload pending", "the file has not finished uploading"],
                ["Checking", "the antivirus is checking the file"],
                ["Verified", "the file is accepted and can be used"],
                ["Waiting for verification", "the check could not finish; choose “Retry verification”"],
                ["Rejected", "the file failed the check (for example, a virus was found); remove it and upload another"],
              ] } },
              { note: "An unfinished file blocks submission. If an upload broke off, choose “Retry verification” or **Remove** and upload the file again.", tone: "warn" },
              { p: "The files themselves are **never published**. The public page shows only their digital fingerprint (SHA-256): it proves the document was not swapped without revealing its contents." },
            ],
          },
          {
            id: "submit",
            title: "Sending for review",
            blocks: [
              { p: "When everything is filled in, choose **Submit for review**. If something is missing, the app shows a **Complete these items before submitting:** list with the exact fields." },
              { h: "What it takes to get a certificate" },
              { ul: [
                "all required fields in the four sections are filled in;",
                "the treated area is not larger than the field area;",
                "at least one **verified** weather file and one **verified** product document;",
                "no unfinished or rejected files;",
                "an administrator's approval and publication by the publisher (Hartolit does this part).",
              ] },
              { note: "After submission the record and its evidence are frozen: they cannot be changed until an administrator returns the record for changes.", tone: "info" },
            ],
          },
          {
            id: "after-review",
            title: "After review: fixing and resubmitting",
            blocks: [
              { p: "The **My submitted passports** block shows the state of your records. Choose **Refresh** to see the latest state. The administrator's note, if any, appears under the record." },
              { ol: [
                "Status **Changes requested** or **Rejected** → read the note.",
                "Choose **Reopen for editing**. The record becomes a draft again and the note is shown as “Previous review note”.",
                "Fix the data or evidence and submit again.",
              ] },
              { example: "an administrator's note", lines: [
                "“The treated area of 60 ha is larger than the field area of 56.2 ha. Check the area against the flight map.”",
                "You open the record, change the treated area to 48 ha and submit again.",
              ] },
            ],
          },
          {
            id: "certificate",
            title: "The certificate and the public page",
            blocks: [
              { p: "After publication an **Issued · token #…** mark appears next to the record. It opens the certificate's public page. Anyone can open that page, without an account or a wallet." },
              { h: "What the public page shows" },
              { ul: [
                "the verification result (see the table below) and every public treatment fact;",
                "a link and a **QR code** to share, plus “Print or save as PDF” and “Download public document (JSON)”;",
                "blockchain data: contract, token owner, number of confirmations.",
              ] },
              { table: { head: ["What the page shows", "What it means"], rows: [
                ["**Verified**", "the data is exactly what is fixed on the blockchain"],
                ["**Pending**", "just published; check again in a minute"],
                ["**Unavailable**", "the network is not answering for now; this is not a conclusion about the record"],
                ["**Does not verify**", "the data does not match the blockchain; do not rely on the record"],
              ] } },
              { h: "What is public and what is not" },
              { table: { head: ["Public (everyone sees)", "Private (Hartolit administrators only)"], rows: [
                ["public farm name, public field code, area, crop", "legal name, EDRPOU/tax number, GPS, cadastral number"],
                ["type, date, time, time zone, treated area, drone model", "operator's name, licence, drone serial number, notes"],
                ["weather and measurement time", "your email and account details"],
                ["product, active substance, dose, working volume, manufacturer, registration no.", "supplier and its EDRPOU"],
                ["fingerprints (SHA-256) of the weather file and product document", "the files themselves"],
              ] } },
              { note: "A certificate proves only that the published data has not changed. It does not prove the treatment was appropriate or qualifies for compensation.", tone: "info" },
              { note: "While the service runs on the test network (BSC Testnet), the page marks records as pilot records: they are not production certificates yet.", tone: "info" },
            ],
          },
          {
            id: "corrections",
            title: "A mistake in a published certificate",
            blocks: [
              { p: "A published certificate cannot be changed, by design. If it contains a mistake, tell an administrator. They open a **correction**:" },
              { ol: [
                "A copy of the record marked **Correction of certificate** appears in your drafts.",
                "Fix the data and **upload the evidence again**: it is not copied.",
                "Submit the record for review as usual.",
                "Once the correction is published, the old public page says it was replaced and links to the new certificate.",
              ] },
              { note: "Until the correction is published, the old page warns that a correction is in progress.", tone: "info" },
            ],
          },
        ],
      },
      {
        title: "Reference",
        sections: [
          {
            id: "privacy",
            title: "Privacy and safety",
            blocks: [
              { ul: [
                "Never share your password, authenticator codes or recovery codes. Hartolit staff **never** ask for them.",
                "Do not put personal names, phones, addresses or document numbers in the public farm name.",
                "Do not include farmers' personal data in feedback.",
                "On a shared computer, choose **Sign out** when you finish.",
                "Got a suspicious email claiming to be from Hartolit? Do not follow the link; tell an administrator.",
              ] },
              { note: "Anything published to IPFS and the blockchain **cannot be deleted**. Check every value marked as public.", tone: "warn" },
            ],
          },
          {
            id: "retention",
            title: "How long data is kept",
            blocks: [
              { ul: [
                "Submitted, reviewed and published records are not deleted automatically.",
                "A draft that was **never submitted** and not changed for **90 days** may be deleted. You get an email first.",
                "Deletion can happen no earlier than **30 days after the email** and only if the draft was still not changed. Any change cancels the deletion.",
                "The public data of a published certificate stays available for good.",
              ] },
            ],
          },
          {
            id: "feedback",
            title: "Feedback about the app",
            blocks: [
              { p: "At the bottom of the home page there is **Leave feedback**. Rate how convenient the app is from 1 to 5 and write what to improve (10 to 2000 characters). Only administrators see feedback. You can send up to 5 per hour." },
              { p: "Be specific: “on the phone the Submit button hides under the keyboard” helps more than “inconvenient”." },
            ],
          },
          {
            id: "faq",
            title: "Common questions and problems",
            blocks: [
              { qa: [
                ["The invitation or password-reset email does not arrive.", "Check the spam folder. The link is valid for 1 hour. If there is no email, ask an administrator to check the address, or use “Forgot password?” on the sign-in page."],
                ["It says “Could not sign in” although the password is right.", "You may have used up 5 attempts in 15 minutes. Wait 15 minutes. If an administrator disabled your access, sign-in is impossible: contact them."],
                ["I lost the phone with my authenticator.", "Sign in with a recovery code (“Use a recovery code”) and replace the authenticator on the security page. If you have no codes, contact an administrator."],
                ["“Submit for review” shows a list of missing fields.", "Fill in every field in the list. Most often a verified weather file or product document is missing, or an unfinished file is left."],
                ["A file is stuck on “Checking” or “Waiting for verification”.", "Choose “Retry verification”. If that does not help, remove the file and upload it again. Check the size (up to 10 MB) and the format."],
                ["A file is “Rejected”.", "The antivirus or format check refused it. Save the document again (for example as PDF) and upload it once more."],
                ["I want to change a record I already submitted.", "While it is under review it cannot be changed. Ask an administrator to return it for changes."],
                ["The public page shows “Unavailable”.", "The network is not answering for now. It does not mean anything is wrong with the certificate. Try later."],
                ["The public page shows “Does not verify”.", "Tell a Hartolit administrator at once and do not use this certificate until it is cleared up."],
              ] },
            ],
          },
          {
            id: "glossary",
            title: "Glossary",
            blocks: [
              { table: { head: ["Word", "In plain words"], rows: [
                ["Blockchain", "a public register in which the past cannot be rewritten"],
                ["Fingerprint (hash, SHA-256)", "a “fingerprint” of a text or file: change one letter and it is a different fingerprint"],
                ["Two-step sign-in (2FA, MFA)", "signing in with a password and a code from your phone"],
                ["Evidence", "a private file that supports the record's data"],
                ["IPFS", "a storage network where a document is found by its fingerprint"],
                ["QR code", "a square code a phone opens as a link to the public page"],
                ["Testnet", "the blockchain test network for the pilot, with no real money"],
                ["Token", "the certificate's number on the blockchain, for example #1"],
                ["Draft", "a record not yet sent for review"],
              ] } },
            ],
          },
        ],
      },
    ],
  },
};
