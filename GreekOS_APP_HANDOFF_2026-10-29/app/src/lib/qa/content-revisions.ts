/**
 * Methodological content revisions of the corpus, applied through the normal patch path (new
 * immutable revision, history, revocation of releases of the old hash, re-run of digital QA).
 *
 * Authorship is recorded honestly: these texts were written with AI assistance (system actor below),
 * not by a teacher or native-speaker reviewer, and they open nothing — admission stays with the owner.
 * Each revision is idempotent and guarded: it applies only while the item still has the exact text it
 * was written against, so a later edit by the owner is never overwritten.
 */
import { adminClient } from '../supabase/admin.ts';
import { patchItem } from './release.ts';
import { audit } from '../audit.ts';
import { contentHash, sha256Hex, stableStringify } from '../content/stable-json.ts';
import type { ItemEnvelope } from '../content/types.ts';
import { READING_ITEMS, type ReadingItemSpec } from './data/reading-items.ts';
import { runQaBatch } from './run.ts';

export const CONTENT_REVISION_ACTOR = 'ai-assisted-content-revision/1.0';

/** `supersedes`: earlier texts of this same revision that a re-run may replace (never anyone else's edit). */
interface ExplanationRevision { item_id: string; before_rationale: string; explanation_ru: string; supersedes?: string[] }

/**
 * Russian explanations for items whose author's rationale was Greek-only (59 items in 15 lessons,
 * found by the per-lesson content report). They explain why the key is right and what the wrong
 * options get wrong, quoting the Greek of the task; the Greek note stays and is shown under the
 * Russian one at B1–B2.
 */
export const EXPLANATION_REVISIONS: ExplanationRevision[] = [
  { item_id: "U-A1-012-I10", before_rationale: "Ελένη φοιτήτρια, Πέτρος μαθητής; мать врач.", explanation_ru: "В тексте Πέτρος — «μαθητής», то есть школьник: «Ο αδελφός μου, ο Πέτρος, είναι μαθητής». Елена — «φοιτήτρια», студентка вуза, а мама — «γιατρός», врач: она вообще не учится. Запомните пару: μαθητής — ученик школы, φοιτητής / φοιτήτρια — студент университета." },
  { item_id: "U-A1-019-I02", before_rationale: "Πώς σε λένε ζητά το όνομα.", explanation_ru: "«Πώς σε λένε;» дословно значит «как тебя называют», то есть «как тебя зовут» — это вопрос об имени. О городе спросили бы «Πού μένεις;», о профессии — «Τι δουλειά κάνεις;»." },
  { item_id: "U-A2-006-I08", before_rationale: "Не έρχεται и не ερχόμαστε.", explanation_ru: "έρχομαι («прихожу») спрягается с окончаниями на -ομαι. Третье лицо множественного числа — «έρχονται» («они приходят»), окончание -ονται. Частые ошибки: «έρχεται» — это «он / она приходит» (3 л. ед. ч.), «ερχόμαστε» — «мы приходим» (1 л. мн. ч.)." },
  { item_id: "U-B1-008-I16", before_rationale: "να + μην; не δεν.", explanation_ru: "Отрицательная цель строится так: «για να μην» — «чтобы не». После «να» отрицание всегда «μην», а не «δεν»: «Κλείνω το παράθυρο για να μην κρυώσουμε» — «Закрываю окно, чтобы мы не замёрзли». «για να δεν» по-гречески невозможно." },
  { item_id: "U-B1-009-I03", before_rationale: "2 мн. είχατε.", explanation_ru: "Давнопрошедшее время (υπερσυντέλικος) = прошедшее время глагола έχω + неизменяемая форма глагола («διαβάσει»). Для «εσείς» нужна форма «είχατε»: «Εσείς είχατε διαβάσει το κείμενο πριν από τη συζήτηση» — «Вы прочитали текст ещё до обсуждения». Все формы: είχα, είχες, είχε, είχαμε, είχατε, είχαν." },
  { item_id: "U-B1-009-I07", before_rationale: "3 мн. έχουν.", explanation_ru: "Перфект = настоящее время έχω + неизменяемая форма глагола: «Έχουν ήδη τελειώσει» — «Они уже закончили». Для «они» нужна форма «έχουν»: «έχει» — это «он / она», а «είχαν» дало бы давнопрошедшее время. Наречие «ήδη» может стоять и до, и после «τελειώσει»." },
  { item_id: "U-B1-017-I02", before_rationale: "Δωρεάν αφορά κόστος· κράτηση αφορά διαδικασία.", explanation_ru: "«δωρεάν» говорит о цене (платить не нужно), «χρειάζεται κράτηση» — о порядке входа (нужно забронировать место). Союз «αλλά» соединяет оба условия, поэтому верно «Δεν πληρώνετε, αλλά πρέπει να κρατήσετε θέση». Вариант «без брони» противоречит второй части сообщения, а о запрете входа в нём ничего нет." },
  { item_id: "U-B2-004-I07", before_rationale: "40<60.", explanation_ru: "Сравниваем только цены: первый зал стоит 40 евро, второй — 60 евро. «φθηνότερη» — «дешевле», значит ответ «η πρώτη». То, что второй зал ближе к остановке и удобнее, касается доступа, а не цены." },
  { item_id: "U-B2-005-I02", before_rationale: "μέσω + gen; με + acc.", explanation_ru: "Предлог «μέσω» («через, посредством») требует родительного падежа: «μέσω της πλατφόρμας». А в сочетании «σχετικά με» («относительно, по поводу») управляет «με», то есть винительный падеж: «σχετικά με την αίτηση». Ответ: «της, την»." },
  { item_id: "U-B2-005-I07", before_rationale: "μέσω + gen.", explanation_ru: "«μέσω» требует родительного падежа: «μέσω του εκπροσώπου» — «через представителя». Артикль «ο» в родительном падеже — «του», окончание -ος меняется на -ου. Ошибка «μέσω τον εκπρόσωπο» — это винительный падеж." },
  { item_id: "U-B2-017-I01", before_rationale: "Η επιφύλαξη δεν είναι απόρριψη ούτε εγγύηση.", explanation_ru: "Оговорка «εφόσον υπάρχει προσωπικό» («при условии, что есть персонал») — это условие, а не отказ и не гарантия. Автор поддерживает испытание, но только при этом условии, и не обещает, что оно удастся. Хороший ответ называет обе стороны: что поддерживается и чего автор не гарантирует." },
  { item_id: "U-B2-017-I02", before_rationale: "Το συμπέρασμα της §5 συνδυάζεται με την πρόταση της §4. Η καθολική επέκταση, η απόρριψη και ο αποκλειστικά ψηφιακός στόχος δεν υποστηρίζονται.", explanation_ru: "Основная мысль складывается из §4 и §5. В §4 автор предлагает: «προτείνουμε μια τρίμηνη δοκιμή… και δημόσια αξιολόγηση» — трёхмесячное испытание с публичной оценкой. В §5 вопрос ставится так: «υπό ποιες προϋποθέσεις» вечерние часы приносят пользу. Расширить часы всех библиотек сразу, отменить вечернюю работу или заменить выдачу книг цифровыми услугами статья не предлагает." },
  { item_id: "U-B2-017-I03", before_rationale: "Δεν ισχυρίζεται ότι όλοι οι αντίπαλοι αδιαφορούν για την παιδεία.", explanation_ru: "В §1 сказано: «Η άποψη αυτή… θεωρεί δεδομένο ότι όλοι διαθέτουν τον ίδιο ελεύθερο χρόνο» — противники исходят из того, что у всех одинаковое свободное время и все могут прийти утром. Автор оспаривает это допущение, а не мотивы: он не утверждает, что противники равнодушны к образованию." },
  { item_id: "U-B2-017-I04", before_rationale: "Αποδεκτό επίσης: ποιοι παραμένουν αποκλεισμένοι. Δεν απαιτείται ίδια διατύπωση.", explanation_ru: "По §3 число посетителей за первую неделю ничего не доказывает: «εκδήλωση εγκαινίων» (открытие) может временно заполнить зал без устойчивой потребности. Статья предлагает данные о повторных визитах («επαναλαμβανόμενες επισκέψεις») и об услугах, которыми пользуются; засчитывается и третий пункт — кто по-прежнему остаётся без доступа. Формулировка может быть своей." },
  { item_id: "U-B2-017-I05", before_rationale: "Η αναφορά κόστους δεν περιλαμβάνει ποσό. Η άγνοια ποσού δεν συνεπάγεται μηδενικό κόστος.", explanation_ru: "Статья говорит о расходах (персонал, отопление, оплата сотрудников — §3 и §4), но суммы не называет. Значит, верно «Δεν παρέχει αυτό το στοιχείο» — таких данных в тексте нет. Отсутствие суммы не означает, что затраты нулевые." },
  { item_id: "U-B2-017-I06", before_rationale: "Το ημερολόγιο και το αίτημα δεν αποτελούν έγκριση.", explanation_ru: "Пункт Γ: «Περιμένετε γραπτή επιβεβαίωση» — ждите письменного подтверждения. Отметка «ελεύθερη» в календаре (пункт Α) и отправка заявки (пункт Β) бронью не являются — инструкция говорит это прямо." },
  { item_id: "U-B2-017-I07", before_rationale: "Ελέγχεται πραγματική εκτέλεση της οδηγίας, όχι απομνημόνευση όρων.", explanation_ru: "Проверяется, применяете ли вы правило Γ, а не помните ли его слова. Через два рабочих дня без ответа нужно связаться с секретариатом («επικοινωνώ με τη γραμματεία») и не отправлять вторую такую же заявку («δεν στέλνω δεύτερο ίδιο αίτημα»). И нельзя считать бронь подтверждённой." },
  { item_id: "U-B2-017-I09", before_rationale: "Το κλειδί αφορά τη διαδικασία· η προφορά απαιτεί πραγματική ηχογράφηση.", explanation_ru: "Главное в ответе коллеге: свободная дата в календаре — ещё не бронь. Сначала заявка и письменное подтверждение, и только потом приглашения: «Η διαθεσιμότητα από μόνη της δεν αποτελεί κράτηση». Произношение и беглость оцениваются только по настоящей записи голоса." },
  { item_id: "U-B2-017-I10", before_rationale: "Πρόγνωση βροχής δεν είναι ήδη βροχή· κράτησε το ενδεχόμενο.", explanation_ru: "Сообщение должно исправить план по двум условиям правила: без ответственного («υπεύθυνος») сад использовать нельзя, а в дождь мероприятие отменяется и автоматически в помещение не переносится. Прогноз дождя — ещё не дождь: пишите о нём как о возможности («σε περίπτωση βροχής…»), а не как о свершившемся факте. Не придумывайте разрешений, которых нет." },
  { item_id: "U-B2-018-I01", before_rationale: "Ελέγχεται ανταπόκριση, όχι μόνο αρχική πρόταση.", explanation_ru: "Оценивается, учли ли вы новую информацию: собеседник работает до трёх, поэтому нужно предложить время позже, например «Τότε ας συναντηθούμε μετά τις τέσσερις, αν σε εξυπηρετεί». Повторить утреннее предложение — значит не ответить на возражение." },
  { item_id: "U-B2-018-I02", before_rationale: "Η απάντηση συνδέει κόστος και πρόσβαση· οι άλλες αγνοούν ή αλλοιώνουν το πρόβλημα.", explanation_ru: "Возражение касается доступности: в зале нет лифта. Ответ «Ας βρούμε προσβάσιμο χώρο εντός του ίδιου προϋπολογισμού» учитывает обе стороны — и цену, и доступ. «Είπα ήδη ότι είναι φθηνότερη» игнорирует проблему, а «Άρα δεν θέλεις να γίνει καμία εκδήλωση» искажает позицию собеседника." },
  { item_id: "U-B2-018-I05", before_rationale: "Αρκεί να + ρήμα δηλώνει τον όρο.", explanation_ru: "Условие после «αρκεί» («лишь бы, при условии что») вводится частицей «να» + глагол: «Συμφωνώ, αρκεί να επιβεβαιωθεί η πρόσβαση» — «Согласен, при условии что доступ будет подтверждён»." },
  { item_id: "U-B2-018-I09", before_rationale: "Η κοινή απόφαση περιλαμβάνει και τον μηχανισμό αποτυχίας.", explanation_ru: "В протоколе должно быть и решение, и запасной вариант: зал Β — только если он свободен («υπό τον όρο ότι είναι διαθέσιμος»), проверяет Элени, ответ до вторника, иначе — новое обсуждение. Нельзя писать, что зал уже забронирован." },
  { item_id: "U-B2-018-I11", before_rationale: "Ελέγχονται διακριτικότητα και εφαρμόσιμος συμβιβασμός.", explanation_ru: "Оцениваются тактичность и реалистичный компромисс: возразить, предложить вариант и задать вопрос, не раскрывая чужих финансов. Например: «Θα προτιμούσα κάτι οικονομικότερο ώστε να συμμετέχουμε όλοι» — «Я бы предпочёл место подешевле, чтобы пошли все», без упоминания, у кого мало денег." },
  { item_id: "U-B2-018-I12", before_rationale: "Δεκτή άλλη τεκμηριωμένη επιλογή· όχι επινόηση χαρακτηριστικών.", explanation_ru: "Можно выбрать любой инструмент, если выбор обоснован. Нужны решение, причина, условие («εφόσον…») и следующий шаг, например проверка через неделю. Нельзя приписывать инструментам свойства, которых нет в условии задания." },
  { item_id: "U-B2-019-I01", before_rationale: "Το άτονο αντικείμενο συμφωνεί με το θηλυκό πληθυντικό.", explanation_ru: "Безударное местоимение повторяет вынесенное вперёд дополнение «Τις αιτήσεις» и согласуется с ним: женский род, множественное число, винительный падеж — «τις». «Τις αιτήσεις τις παρέλαβα χθες» — «Заявления я получил вчера»." },
  { item_id: "U-B2-019-I02", before_rationale: "Μόνο περιορίζει το υποκείμενο, όχι το περιεχόμενο της απάντησης.", explanation_ru: "«μόνο» стоит перед подлежащим «η Άννα» и ограничивает именно его: ответила только Анна, больше никто — «Κανείς άλλος δεν απάντησε». О длине или времени её ответа фраза ничего не говорит." },
  { item_id: "U-B2-019-I03", before_rationale: "Δεν αποκλείονται άλλοι άνθρωποι που έκαναν διορθώσεις.", explanation_ru: "Здесь «μόνο» стоит перед дополнением «την ημερομηνία»: Анна исправила только дату и больше ничего. Из этого не следует, что никто другой ничего не исправлял, и не следует, что дата была единственной ошибкой." },
  { item_id: "U-B2-019-I04", before_rationale: "Το αντικείμενο παραμένει αιτιατική· η ουδέτερη μορφή δεν αλλάζει.", explanation_ru: "Дополнение выносят в начало и повторяют безударным местоимением того же рода и числа: «Τα στοιχεία τα ελέγξαμε». «τα στοιχεία» — средний род, множественное число, винительный падеж; у среднего рода он совпадает с именительным, поэтому меняется только порядок слов и добавляется «τα»." },
  { item_id: "U-B2-019-I12", before_rationale: "Δεν δηλώνεται ότι οι υπόλοιπες απορρίφθηκαν.", explanation_ru: "Исправление должно точно передать факты: обсуждали все изменения, утвердили только изменения времени. Например: «Τις αλλαγές τις συζητήσαμε όλες, αλλά εγκρίθηκαν μόνο όσες αφορούν την ώρα». Нельзя писать, что остальные изменения отклонены: решение по ним ещё не принято. И без упрёков читателю." },
  { item_id: "U-B2-020-I01", before_rationale: "Δεν γνωρίζουμε τον αριθμό μοναδικών προσώπων.", explanation_ru: "«50 επισκέψεις» — это 50 посещений, а не 50 разных людей: один человек мог прийти несколько раз. Уверенно можно сказать только «Καταγράφηκαν 50 επισκέψεις»." },
  { item_id: "U-B2-020-I02", before_rationale: "Η Β ορίζει τον χρονικό ορίζοντα της διαθεσιμότητας.", explanation_ru: "Источник Β: «Δεν έχουν δεσμευτεί για το υπόλοιπο έτος» — волонтёры не брали обязательств на остаток года. Они могут помогать два дня в неделю после обеда, но только месяц." },
  { item_id: "U-B2-020-I03", before_rationale: "Το δείγμα είναι εθελοντικό και τοπικό, όχι όλος ο πληθυσμός.", explanation_ru: "По источнику Γ опрос был добровольным и проводился в самой мастерской, а не среди всех жителей. Поэтому корректно только «14 από τους 20 που απάντησαν» — 14 из 20 ответивших. «70% всех жителей» переносит выводы маленькой выборки на всех." },
  { item_id: "U-B2-020-I04", before_rationale: "Σύνθεση σχέσης, όχι δύο ασύνδετες περιλήψεις.", explanation_ru: "Нужно связать два источника, а не пересказать каждый отдельно. В А встречи отменяли «λόγω έλλειψης προσωπικού» — из-за нехватки персонала, а волонтёры из Β доступны только месяц. Значит, это временное решение, постоянной работы оно не обеспечивает." },
  { item_id: "U-B2-020-I05", before_rationale: "Τρία σφάλματα: οριστική έγκριση, μοναδικά άτομα, ηλικία.", explanation_ru: "Во фразе три ошибки. (1) Источник Δ называет сумму «έως 600€» при условии плана расходов, и это не утверждение программы. (2) А фиксирует 80 посещений, а не 80 разных людей. (3) Данных о возрасте нет: «Δεν συλλέχθηκαν στοιχεία ηλικίας», поэтому «νέοι» — домысел. Для каждой правки укажите источник." },
  { item_id: "U-B2-020-I10", before_rationale: "Πραγματική σύνθεση τριών πληροφοριών.", explanation_ru: "Сопоставьте три факта: встреча заканчивается «περίπου στις 17:50, ίσως αργότερα», до остановки 15 минут пешком, автобус уходит в 18:00. Даже если закончить в 17:50, к 18:00 на остановку не успеть, поэтому гарантировать пересадку нельзя. Посоветуйте проверить следующий рейс или уйти раньше." },
  { item_id: "U-B2-020-I11", before_rationale: "Μην αποκαλείς τη σύνδεση κακή: είναι αδοκίμαστη.", explanation_ru: "Не называйте связь плохой: она не проверена («αδοκίμαστη»). Сведите три факта: 12 из 18 хотят гибридный формат, микрофон есть, но связь не проверяли, ответственный свободен только первый час. Желание 12 участников — не доказательство технической готовности; следующий шаг — проверить связь и обеспечить техническую поддержку." },
  { item_id: "U-B2-021-I02", before_rationale: "Κατανόηση δεν σημαίνει συμφωνία.", explanation_ru: "«Καταλαβαίνω τον λόγο σας, αλλά δεν συμφωνώ με την πρόταση»: говорящий признаёт довод собеседника, но не принимает предложение. Понять — не значит согласиться, а извинений во фразе нет." },
  { item_id: "U-B2-021-I04", before_rationale: "Είναι χρήσιμο να ζητηθεί απάντηση πριν από την απόφαση, όχι να επινοηθεί υποχρέωση.", explanation_ru: "В просьбе нет срока. Если решение принимают в пятницу, нужно сказать, до какого дня нужен ответ, — «η προθεσμία απάντησης», например «Θα μπορούσατε να μας απαντήσετε έως την Πέμπτη;». Срок задаётся вежливо, без выдуманных обязательств адресата." },
  { item_id: "U-B2-021-I06", before_rationale: "Το «θα το αλλάξουμε σίγουρα» αλλοιώνει τον βαθμό βεβαιότητας.", explanation_ru: "Нужно перейти на дружеский стиль и сохранить степень уверенности: изменение ещё не одобрено. Например: «Ρώτησα αν μπορούμε να αλλάξουμε την ώρα, αλλά δεν μου έχουν πει ακόμη ότι γίνεται». Фраза «θα το αλλάξουμε σίγουρα» («точно поменяем») искажает смысл." },
  { item_id: "U-B2-021-I07", before_rationale: "Δεν απαιτείται νομική επιχειρηματολογία ούτε αντιγραφή του μοντέλου.", explanation_ru: "Письмо оценивается по задаче: поддержка цели семинара, проблема обязательных утренних встреч для работающих, два решения (например, второе расписание или записи с возможностью задать вопросы) и конкретная просьба ответить до срока. Юридическая аргументация не нужна, образец копировать не надо. Полезные формулы: «Στηρίζω τον στόχο του σεμιναρίου», «Θα ήθελα να εξετάσετε…», «Θα ήθελα ενημέρωση πριν ολοκληρωθούν οι εγγραφές».", supersedes: ["Письмо оценивается по задаче: поддержка цели семинара, проблема обязательных утренних встреч для работающих, два решения (например, второе расписание или записи с возможностью задать вопросы) и конкретная просьба ответить до срока. Юридическая аргументация не нужна, образец копировать не надо."] },
  { item_id: "U-B2-021-I10", before_rationale: "Παραγωγή με συνομιλητή· solo μόνο rehearsal.", explanation_ru: "Это задание для разговора с собеседником; в одиночку его можно только отрепетировать. Нужно договориться о часах тишины, не требуя полной тишины весь день, задать уточняющий вопрос (например, о графике соседа) и закончить пробной договорённостью с пересмотром через неделю, например: «Ας το δοκιμάσουμε για μία εβδομάδα και μετά το ξανασυζητάμε».", supersedes: ["Это задание для разговора с собеседником; в одиночку его можно только отрепетировать. Нужно договориться о часах тишины, не требуя полной тишины весь день, задать уточняющий вопрос (например, о графике соседа) и закончить пробной договорённостью с пересмотром через неделю."] },
  { item_id: "U-B2-022-I01", before_rationale: "Δεκτές ισοδύναμες αντιθετικές συνδέσεις.", explanation_ru: "Нужна связка противопоставления: «Ωστόσο, δεν εγγυάται επισκευή» — «Однако ремонта она не гарантирует». Засчитываются и равнозначные связки: «Όμως», «Παρ’ όλα αυτά»." },
  { item_id: "U-B2-022-I02", before_rationale: "Ο στόχος δεν είναι καθολική δωρεάν επισκευή ή κατάργηση τεχνιτών.", explanation_ru: "В §1 цель — не заменить мастеров и не бесплатный ремонт всего подряд, а научить людей понимать, «πότε μια απλή παρέμβαση είναι ασφαλής και πότε χρειάζεται ειδικός» — когда простое вмешательство безопасно, а когда нужен специалист." },
  { item_id: "U-B2-022-I03", before_rationale: "Όχι απλώς στο επισκευασμένο αντικείμενο.", explanation_ru: "«Αυτή η γνώση» в §3 относится к тому, чему научились участники, а не к починенной вещи: умение точно описать неисправность и понимание, когда ремонт экономически невыгоден." },
  { item_id: "U-B2-022-I04", before_rationale: "Η καταγραφή εξηγεί το επόμενο αποτέλεσμα· οι άλλες επιλογές αναιρούν το κείμενο ή δεν συνδέονται.", explanation_ru: "Пропуск должен объяснять следующую фразу: организаторы узнают, сколько заявок осталось без ответа, только если такие заявки записывают. Поэтому подходит «Παράλληλα αποφασίστηκε να καταγράφονται όσοι δεν εξυπηρετούνται». Остальные варианты противоречат тексту или с ним не связаны." },
  { item_id: "U-B2-022-I05", before_rationale: "Δύο υπερβολές: απόδειξη αποτελέσματος και επάρκεια εθελοντισμού.", explanation_ru: "В резюме два преувеличения. (1) Данных о сокращении отходов нет: «οι οργανωτές δεν έχουν ακόμη στοιχεία» (§3). (2) Статья прямо говорит, что инициатива не доказывает, будто «ο εθελοντισμός αρκεί για όλα» (§5). Исправленный вариант должен сохранить эти оговорки." },
  { item_id: "U-B2-022-I06", before_rationale: "Αρχική εντύπωση, αντίθεση, συμπέρασμα.", explanation_ru: "Логика: сначала впечатление (Β «Η συσκευή φαίνεται απλή»), затем противопоставление (Γ «Ωστόσο…»), затем вывод (Α «Γι’ αυτό…»). «Ωστόσο» требует предыдущей мысли, а «Γι’ αυτό» — причины. Ответ: Β-Γ-Α." },
  { item_id: "U-B2-022-I08", before_rationale: "Ανάκληση σημασίας· όχι οδηγίες τεχνικής επισκευής.", explanation_ru: "Это проверка смысла по памяти: чего можно ждать от мастерской (обучение и помощь) и чего нельзя (гарантированного ремонта, работ без специалиста там, где нужна лицензия). Технические инструкции по ремонту не требуются. Ядро ответа: «Μπορεί να περιμένει καθοδήγηση και μάθηση, όχι εγγυημένη επισκευή».", supersedes: ["Это проверка смысла по памяти: чего можно ждать от мастерской (обучение и помощь) и чего нельзя (гарантированного ремонта, работ без специалиста там, где нужна лицензия). Технические инструкции по ремонту не требуются."] },
  { item_id: "U-B2-022-I09", before_rationale: "Μην αποδώσεις την προτεινόμενη έκδοση στο μουσείο.", explanation_ru: "Резюме передаёт только сказанное о музее: виртуальные экскурсии расширяют доступ, требуют хорошей связи и не заменяют настоящего посещения. Свой комментарий — отдельной, явно помеченной фразой («Προσωπικό σχόλιο: …»). Не приписывайте музею собственное предложение, например облегчённую версию." },
  { item_id: "U-B2-022-I10", before_rationale: "Εντοπισμός δεν ισοδυναμεί με αιτιακή εξήγηση.", explanation_ru: "«Αυτή η διαδικασία» отсылает к записи заявок — «η καταγραφή των αιτημάτων». В резюме сохраните оговорку: запись выявила повторяющиеся проблемы, но не объяснила их причины. Обнаружить — не значит объяснить." },
  { item_id: "U-B2-022-I11", before_rationale: "Μην μετατρέψεις τη δήλωση ικανοποίησης σε απόδειξη αύξησης παραγωγικότητας.", explanation_ru: "Нейтральная записка не выдаёт заявленную удовлетворённость за доказанный рост производительности: производительность не измерялась («Δεν μετρήθηκε»). Включите короткое испытание, рост удовлетворённости по словам сотрудников, неизвестную производительность и предстоящую проверку потребностей клиентов." },
  { item_id: "U-B2-023-I01", before_rationale: "Ελέγχει στόχο και σχετικό λόγο.", explanation_ru: "В двух фразах назовите адресата и точную просьбу с причиной: занятие перенесли на 15:00, а вы работаете до 16:00. Например: «Απευθύνομαι στον διοργανωτή. Ζητώ εναλλακτικό ωράριο ή τρόπο συμμετοχής, επειδή δεν προλαβαίνω»." },
  { item_id: "U-B2-023-I02", before_rationale: "Οι άλλες φράσεις αποδίδουν ατεκμηρίωτα πρόθεση.", explanation_ru: "Проверяемый факт — то, что подтверждается документом: «Στην επιβεβαίωσή μου η έναρξη αναφέρεται στις 18:00». Две другие фразы без доказательств приписывают организаторам намерения («επειδή δεν σας ενδιαφέρουμε», «θέλετε να αποκλείσετε») — в официальном письме это ошибка." },
  { item_id: "U-B2-023-I05", before_rationale: "Το δεύτερο πρόσωπο πρέπει να παραμείνει πληθυντικό στην επίσημη προσφώνηση.", explanation_ru: "В официальном обращении множественное число вежливости сохраняется до конца фразы: «Σας ευχαριστώ για την απάντησή σας». «σου» — обращение на «ты», оно не сочетается с «Σας» в начале." },
  { item_id: "U-B2-023-I07", before_rationale: "Ο διορθωτής δέχεται άλλες συνεπείς λύσεις και δεν ζητά αντιγραφή.", explanation_ru: "Проверяющий принимает любые решения, согласованные с фактами; копировать план не нужно. Обязательные части: тема; расхождение (подтверждение на 18:00, новое объявление на 15:00); два последствия (работа до 16:00, дорога); возможное ограничение организаторов — как предположение, а не факт; два решения и просьба ответить до закрытия записи 30 октября. Полезные формулы: «Σας γράφω σχετικά με την αλλαγή της ώρας», «Αναγνωρίζω ότι μπορεί να υπάρχουν οργανωτικοί λόγοι», «Θα εκτιμούσα μια απάντηση πριν από τις 30 Οκτωβρίου».", supersedes: ["Проверяющий принимает любые решения, согласованные с фактами; копировать план не нужно. Обязательные части: тема; расхождение (подтверждение на 18:00, новое объявление на 15:00); два последствия (работа до 16:00, дорога); возможное ограничение организаторов — как предположение, а не факт; два решения и просьба ответить до закрытия записи 30 октября."] },
  { item_id: "U-B2-023-I08", before_rationale: "Προσωπικά δεδομένα μπορούν να είναι επινοημένα.", explanation_ru: "Личные подробности можно придумать. Нужны два довода «за», одна тревога, компромисс (например, одна встреча в месяц) и конкретный вопрос другу, например «Πιστεύεις ότι έτσι θα μπορέσω να βοηθήσω ουσιαστικά…;»." },
  { item_id: "U-B2-023-I09", before_rationale: "Δεκτή αιτιολογημένη άρνηση αν δεν υπάρχει συμβατή ημέρα.", explanation_ru: "Новая позиция должна учитывать ответ организатора: менять можно только день. Подойдёт согласие с условием («εφόσον το μάθημα γίνει σε ημέρα που δεν εργάζομαι») и просьба уточнить свободные дни. Обоснованный отказ тоже засчитывается, если подходящего дня нет." },
  { item_id: "U-B2-023-I12", before_rationale: "Αξιολόγηση νέου πλήρους κειμένου χωρίς μοντέλο.", explanation_ru: "Оценивается новый самостоятельный текст без образца: просьба о пробном расширении часов, аргументы, честное признание затрат как реального ограничения и способ оценки (например, учёт посещаемости). Не обещайте, что посещаемость покроет все расходы. Например: «Θα πρότεινα μια περιορισμένη δοκιμή με καταγραφή της χρήσης».", supersedes: ["Оценивается новый самостоятельный текст без образца: просьба о пробном расширении часов, аргументы, честное признание затрат как реального ограничения и способ оценки (например, учёт посещаемости). Не обещайте, что посещаемость покроет все расходы."] },
];

export type RevisionStatus = 'applied' | 'already' | 'changed_since' | 'missing';

export async function applyExplanationRevisions(): Promise<Array<{ item_id: string; status: RevisionStatus; new_hash?: string }>> {
  const db = adminClient();
  const out: Array<{ item_id: string; status: RevisionStatus; new_hash?: string }> = [];
  for (const r of EXPLANATION_REVISIONS) {
    const { data: it } = await db.from('items').select('item_id, envelope, current_hash').eq('item_id', r.item_id).maybeSingle();
    if (!it) { out.push({ item_id: r.item_id, status: 'missing' }); continue; }
    const env = it.envelope as { answer_explanation_ru?: string; original_payload?: { rationale?: unknown } };
    if (env.answer_explanation_ru === r.explanation_ru) { out.push({ item_id: r.item_id, status: 'already' }); continue; }
    const replaceable = !env.answer_explanation_ru || (r.supersedes ?? []).includes(env.answer_explanation_ru);
    if (!replaceable || env.original_payload?.rationale !== r.before_rationale) { out.push({ item_id: r.item_id, status: 'changed_since' }); continue; }
    const p = await patchItem({ system: CONTENT_REVISION_ACTOR }, {
      item_id: r.item_id, base_hash: it.current_hash, changes: { answer_explanation_ru: r.explanation_ru },
      reason: 'Методическая правка: объяснение ответа на русском (пояснение автора было только на греческом; греческие примеры сохранены). Подготовлено с помощью AI, не проверено преподавателем.',
    }, { runQa: false });
    out.push({ item_id: r.item_id, status: 'applied', new_hash: p.new_hash });
  }
  const applied = out.filter((o) => o.status === 'applied').map((o) => o.item_id);
  if (applied.length) await runQaBatch({ actorId: null, label: `Повторная проверка после методических правок (${applied.length})`, scope: { kind: 'items', ids: applied } });
  return out;
}

/**
 * Route order. U-B1-007 («Связное письмо: опыт, причина и запрос») lists B1-G10 («Причина, цель,
 * результат; για να, ώστε, γι’ αυτό») as a prerequisite of every task, but B1-G10 was introduced only
 * by the next lesson, U-B1-008. U-B1-008 depends only on A2 competences, and the writing competence of
 * U-B1-007 is first needed at B2, so the two lessons swap places: the connectors first, then the
 * connected writing that uses them. Order is not part of a lesson's content hash.
 */
export const UNIT_ORDER_REVISIONS: Array<{ unit_id: string; before: number; after: number }> = [
  { unit_id: 'U-B1-008', before: 308, after: 307 },
  { unit_id: 'U-B1-007', before: 307, after: 308 },
];

export async function applyUnitOrderRevisions(): Promise<{ status: RevisionStatus; units: Record<string, number> }> {
  const db = adminClient();
  const ids = UNIT_ORDER_REVISIONS.map((r) => r.unit_id);
  const { data } = await db.from('units').select('unit_id, sort_key').in('unit_id', ids);
  const now = new Map((data ?? []).map((u) => [u.unit_id as string, u.sort_key as number]));
  const units = Object.fromEntries(now);
  if (now.size !== ids.length) return { status: 'missing', units };
  if (UNIT_ORDER_REVISIONS.every((r) => now.get(r.unit_id) === r.after)) return { status: 'already', units };
  if (!UNIT_ORDER_REVISIONS.every((r) => now.get(r.unit_id) === r.before)) return { status: 'changed_since', units };
  for (const r of UNIT_ORDER_REVISIONS) {
    const { error } = await db.from('units').update({ sort_key: r.after }).eq('unit_id', r.unit_id).eq('sort_key', r.before);
    if (error) throw new Error(error.message);
  }
  await audit(null, 'content.reorder', { id: ids.join(',') }, { system_actor: CONTENT_REVISION_ACTOR, changes: UNIT_ORDER_REVISIONS, reason: 'B1-G10 вводится раньше урока, который требует его как предпосылку' });
  return { status: 'applied', units: Object.fromEntries(UNIT_ORDER_REVISIONS.map((r) => [r.unit_id, r.after])) };
}

const SCORING = (strategy: 'CHOICE_KEY' | 'EXACT_WITH_REVIEW_FALLBACK') => ({
  policy: { method: strategy === 'CHOICE_KEY' ? 'key_with_review_fallback' : 'exact_key', normalization: ['NFC', 'trim', 'casefold', 'collapse_whitespace'], strip_accents: false, model_is_exhaustive: false, unlisted_plausible_answer: 'REVIEW_REQUIRED_NO_AUTOMATIC_PENALTY' },
  strategy, unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY' as const, automatic_final_score_allowed: false as const,
});
const LICENSING = {
  originator: 'GreekOS AI-assisted original authoring (content revision 2026-11-05)',
  allowed_uses: ['project editing', 'review', 'future project publication after QA'],
  license_type: 'ORIGINAL_PROJECT_CONTENT', derivative_allowed: true, third_party_assets: false,
  permission_evidence: 'Создано по заданию владельца GreekOS; чужие тексты не воспроизводятся',
  copyright_exclusivity_claimed: false, commercial_web_distribution_allowed: true,
};
type UnitInfo = { unit_id: string; level: string; primary_competencies: string[]; prerequisites: string[]; teaching: Record<string, unknown>; current_hash: string };

/** The full item envelope, in the same shape as the imported corpus items. */
export function readingEnvelope(spec: ReadingItemSpec, unit: Pick<UnitInfo, 'unit_id' | 'level' | 'primary_competencies' | 'prerequisites'>): ItemEnvelope {
  const strategy = spec.type === 'mcq' ? 'CHOICE_KEY' : 'EXACT_WITH_REVIEW_FALLBACK';
  const stimulus = { text: spec.text, origin: 'ORIGINAL_GREEKOS_TEXT' };
  const original_payload = {
    pool: 'course_practice', level: unit.level, stage: 'reading', prompt: spec.prompt, status: 'AUTHORED_DRAFT', item_id: spec.item_id,
    ...(spec.options ? { options: spec.options } : {}), unit_id: unit.unit_id, version: '0.1.0', language: 'el+ru', stimulus, licensing: LICENSING,
    rationale: spec.rationale, rubric_id: `${unit.unit_id}-RUBRIC`, error_tags: spec.error_tags, answer_type: spec.type, source_refs: [],
    item_version: '0.1.0', review_status: 'AI_ASSISTED_REVISION_NOT_INDEPENDENT', competency_ids: unit.primary_competencies,
    accepted_variants: spec.alternatives ?? [], canonical_answers: spec.answer,
  };
  return {
    item_id: spec.item_id, version: '0.1.0', prompt: spec.prompt, type: spec.type, module: 'core', unit_id: unit.unit_id, level: unit.level,
    canonical: { path: `GreekOS_Content_Revisions/items/${spec.item_id}.json`, sha256: sha256Hex(stableStringify(original_payload)) },
    stimulus, model_response: null, rubric: `${unit.unit_id}-RUBRIC`, estimated_effort: null, requires_audio: false, original_payload,
    competency_ids: unit.primary_competencies, prerequisite_ids: unit.prerequisites, source_claim_ids: [], audio_job_ids: [],
    options: spec.options ?? [], answer: spec.answer, accepted_alternatives: spec.alternatives ?? [], criteria: [], error_tags: spec.error_tags,
    scoring: SCORING(strategy) as ItemEnvelope['scoring'],
    release: { state: 'CONTENT_GATED', learner_access: false, automatic_mastery: false, review_required: true },
    answer_explanation_ru: spec.explanation_ru,
  };
}

/** A new revision of a lesson plan (teaching JSON), with history and revocation like patchUnit. */
async function reviseUnitTeaching(u: UnitInfo, teaching: Record<string, unknown>, reason: string): Promise<string> {
  const db = adminClient();
  const hash = sha256Hex(stableStringify(teaching));
  if (hash === u.current_hash) return hash;
  const { data: rev, error } = await db.from('content_revisions').insert({ content_kind: 'unit', content_id: u.unit_id, content_hash: hash, module: 'core', payload_private: { unit_id: u.unit_id, content_hash: hash, teaching_material: teaching, patched_from: u.current_hash } }).select('id').single();
  if (error) throw new Error(error.message);
  const { error: ue } = await db.from('units').update({ teaching, current_hash: hash, revision_id: rev.id }).eq('unit_id', u.unit_id).eq('current_hash', u.current_hash);
  if (ue) throw new Error(ue.message);
  const changes = { sections: { before: u.teaching.sections ?? null, after: teaching.sections }, reading_tasks: { before: u.teaching.reading_tasks ?? null, after: teaching.reading_tasks } };
  await db.from('content_patches').insert({ content_kind: 'unit', content_id: u.unit_id, base_hash: u.current_hash, new_hash: hash, changes, reason, revision_id: rev.id, created_by: null, system_actor: CONTENT_REVISION_ACTOR });
  await db.from('content_releases').update({ revoked_at: new Date().toISOString(), revoked_reason: 'CONTENT_PATCHED: допуск относился к прежней ревизии' }).eq('content_kind', 'unit').eq('content_id', u.unit_id).is('revoked_at', null);
  return hash;
}

export async function applyReadingItems(): Promise<Array<{ item_id: string; status: RevisionStatus; hash?: string }>> {
  const db = adminClient();
  const out: Array<{ item_id: string; status: RevisionStatus; hash?: string }> = [];
  const touched = new Set<string>();
  for (const spec of READING_ITEMS) {
    const { data: u } = await db.from('units').select('unit_id, level, primary_competencies, prerequisites, teaching, current_hash').eq('unit_id', spec.unit_id).maybeSingle();
    if (!u) { out.push({ item_id: spec.item_id, status: 'missing' }); continue; }
    const unit = u as UnitInfo;
    const env = readingEnvelope(spec, unit);
    const hash = contentHash(env);
    const { data: existing } = await db.from('items').select('current_hash').eq('item_id', spec.item_id).maybeSingle();
    if (existing) { out.push({ item_id: spec.item_id, status: existing.current_hash === hash ? 'already' : 'changed_since', hash: existing.current_hash }); continue; }
    const { data: rev, error } = await db.from('content_revisions').insert({ content_kind: 'item', content_id: spec.item_id, content_hash: hash, module: 'core', payload_private: env }).select('id').single();
    if (error) throw new Error(error.message);
    const { error: ie } = await db.from('items').insert({
      item_id: spec.item_id, module: 'core', unit_id: spec.unit_id, item_type: spec.type, level: unit.level, pool: 'course_practice', section: 'reading',
      requires_audio: false, scoring_strategy: env.scoring.strategy, competency_ids: env.competency_ids, prerequisite_ids: env.prerequisite_ids,
      audio_job_ids: [], error_tags: spec.error_tags, envelope: env, current_hash: hash, revision_id: rev.id,
    });
    if (ie) throw new Error(ie.message);
    await db.from('content_patches').insert({ content_kind: 'item', content_id: spec.item_id, base_hash: 'NEW_ITEM', new_hash: hash, changes: { added: { before: null, after: { section: 'reading', type: spec.type } } }, reason: 'Методическая правка: в уроке не было связного текста для чтения; добавлен оригинальный текст уровня урока с вопросом на понимание. Подготовлено с помощью AI, не проверено преподавателем.', revision_id: rev.id, created_by: null, system_actor: CONTENT_REVISION_ACTOR });
    // The lesson plan lists the new task as a reception (reading) task.
    const t = unit.teaching as { sections?: Record<string, unknown>; reading_tasks?: string[] };
    const sections = { ...(t.sections ?? {}) } as Record<string, unknown>;
    const reception = Array.isArray(sections.reception) ? (sections.reception as string[]) : [];
    sections.reception = [...reception.filter((x) => x !== spec.item_id), spec.item_id];
    const teaching = { ...unit.teaching, sections, reading_tasks: [...(t.reading_tasks ?? []).filter((x) => x !== spec.item_id), spec.item_id] };
    await reviseUnitTeaching(unit, teaching, `Методическая правка: в план урока добавлено задание на чтение ${spec.item_id}.`);
    await audit(null, 'content.add_item', { id: spec.item_id }, { system_actor: CONTENT_REVISION_ACTOR, unit_id: spec.unit_id, hash });
    touched.add(spec.unit_id);
    out.push({ item_id: spec.item_id, status: 'applied', hash });
  }
  if (touched.size) await runQaBatch({ actorId: null, label: `Повторная проверка после добавления заданий на чтение (${touched.size} уроков)`, scope: { kind: 'unit', ids: [...touched] } });
  return out;
}
