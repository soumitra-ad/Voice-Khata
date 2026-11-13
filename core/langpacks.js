'use strict';
// Language packs. Parsing uses the merged UNION lexicon; a pack's own templates are used only for REPLIES.

const { lightKey, canonicalKey } = require('./translit');

const w = (s) => s.trim().split(/\s+/).filter(Boolean);

const PACKS = {
  hi: {
    name: 'Hindi',
    credit_verbs: w('udhaar udhar udhaari baaki baki likho likh likhna credit'),
    payment_verbs: w('jama chukaya chukaye chukayi chuka lautaya lautaye wapas vapas bhara bhare bharpai mila mile milega milegi milenge payment'),
    give_verbs: w('diya diye di de dega degi denge dunga dungi dena dedo'),
    take_verbs: w('liya liye li le lega legi lenge lunga'),
    yes: w('haan han haa ha hanji ji theek thik sahi accha achha bilkul ok okay'),
    no: w('nahi nahin na nah galat'),
    possessive: w('ka ki ke'), agent: w('ne'), recipient: w('ko'), source: w('se'),
    dates: { today: w('aaj aj'), yesterday: [], tomorrow: [], kal: w('kal kl'), parso: w('parso parson') },
    past: w('tha thi the diya diye liya liye kiya kiye gaya gaye gayi chukaya lautaya bhara mila mile aaya aaye'),
    future: w('dega degi denge dunga dungi lega legi lenge lunga karega karegi karunga aayega jayega jayegi milega milegi milenge dene lene'),
    wala: w('wala wale waala wali'), first: w('pehla pahla pehle pehli pahli'), second: w('doosra dusra doosre dusre doosri dusri'),
    third: w('teesra tisra teesri'),
    when: ['aaj', 'kal', 'parso'],
    query: w('total kitna kitne kitni hisaab hisab balance batao bataiye bolo kya kul'),
    undo: w('undo cancel hatao hata mitao mita radd'),
    create: w('naya nayi new'),
    customer_nouns: w('customer khata khaata khaate khate grahak account'),
    reminder: w('reminder yaad'),
    lending: w('loan karz karza byaaj byaj sood interest emi kist kisht'),
    diagnosis: w('bimari beemari bimaari ilaaj diagnosis lakshan nuskha'),
    conj: w('aur phir fir tab'),
    filler: w('hai hain h mein me bhi toh wala wale waala saaman samaan saman kiya kar karo abhi sab sabka sabki sabhi aap main mera mere unka uska uske iska paisa paise tak bas'),
    templates: {
      disclosure: 'Namaste, main AI sahayak hoon. Kiska hisaab likhun?',
      entry_credit: '{amount} udhaar',
      entry_payment: '{amount} jama',
      balance_due: '{name} ka {amount} baaki hai.',
      balance_advance: '{name} ne {amount} advance diya hai.',
      balance_zero: '{name} ka hisaab barabar hai.',
      clarify_direction: '{name} ne diya, ya {name} ko diya?',
      clarify_customer: 'Kiske khaate mein?',
      clarify_amount: 'Kitne rupaye?',
      clarify_repeat: 'Phir se boliye?',
      disambiguate: 'Kaunse {name}: {options}?',
      saved: 'Likh liya.',
      refused_lending: 'Maaf kijiye, loan, byaaj, EMI ka kaam nahi karta.',
      refused_diagnosis: 'Maaf kijiye, dawai ki salah nahi de sakta.',
      reminder: 'Namaste {name}, {amount} baaki. Jab suvidha ho, chuka dijiye.',
      reminder_no_optin: '{name} ne reminder ki anumati nahi di.',
      promise_saved: 'Theek, {when} {amount} milne ka note likh diya.',
      clarify_target: '{options}?',
      target_option: '{amount} wala',
      target_join: ' ya ',
      clarify_future_credit: 'Udhaar abhi diya, ya baad mein denge?',
    },
  },
  mr: {
    name: 'Marathi',
    // TODO native-speaker verify: Marathi joins hundreds into one word.
    hundreds_1_9: w('शंभर दोनशे तीनशे चारशे पाचशे सहाशे सातशे आठशे नऊशे'),
    credit_verbs: w('udhari udhar baki baaki'),
    payment_verbs: w('jama bharle bharla parat chukavle chukavla'),
    give_verbs: w('dile dila dili dya deil denar'),
    take_verbs: w('ghetle ghetla ghetli nela nele neli'),
    yes: w('ho hoy haan barobar chalel'),
    no: w('nahi nako na'),
    possessive: w('cha chi che chya'), possessive_suffix: w('cha chi che chya'),
    agent: w('ne'), agent_suffix: w('ne'), recipient: w('la'), recipient_suffix: w('la'), source: w('kadun'),
    // Marathi kal = yesterday only; udya = tomorrow.
    dates: { today: w('aaj'), yesterday: w('kal kaal'), tomorrow: w('udya udyaa'), kal: [], parso: w('parva') },
    past: w('hote hota hoti dile ghetle kele bharle'),
    future: w('deil denar ghein karel milel'),
    wala: w('vala vali vale wala'), first: w('pahila pahili'), second: w('dusra dusri'), third: w('tisra tisri'),
    when: ['aaj', 'udya', 'parva'],
    query: w('kiti ekun hishob total balance sanga'),
    undo: w('radd kadha cancel undo'),
    create: w('nava navin navi'),
    customer_nouns: w('customer khata grahak giraik'),
    reminder: w('reminder aathvan'),
    lending: w('karj vyaj loan emi interest'),
    diagnosis: w('aajar upchar diagnosis'),
    conj: w('ani aani mag nantar'),
    filler: w('aahe ahe aahet madhe'),
    templates: {
      disclosure: 'Namaskar, mi AI sahayak aahe. Konacha hishob lihu?',
      entry_credit: '{amount} udhari',
      entry_payment: '{amount} jama',
      balance_due: '{name} chi {amount} baki aahe.',
      balance_advance: '{name} ne {amount} advance dile aahet.',
      balance_zero: '{name} cha hishob barobar aahe.',
      clarify_direction: '{name} ne dile, ki {name} la dile?',
      clarify_customer: 'Konachya khatyat?',
      clarify_amount: 'Kiti rupaye?',
      clarify_repeat: 'Parat sanga?',
      disambiguate: 'Konta {name}: {options}?',
      saved: 'Lihun ghetle.',
      refused_lending: 'Maaf kara, karj, vyaj, EMI che kaam karat nahi.',
      refused_diagnosis: 'Maaf kara, aushadhacha salla deu shakat nahi.',
      reminder: 'Namaskar {name}, {amount} baki aahe. Soyi asel tevha bharave.',
      reminder_no_optin: '{name} ni reminder chi parvangi dili nahi.',
      promise_saved: 'Theek, {when} {amount} milnyachi nond keli.',
      target_option: '{amount} vala',
      target_join: ' ki ',
      clarify_future_credit: 'Udhari aata dili, ki nantar denar?',
    },
  },
  bn: {
    name: 'Bengali',
    // TODO native-speaker verify: Bengali joins hundreds into one word.
    hundreds_1_9: w('একশ দুইশ তিনশ চারশ পাঁচশ ছয়শ সাতশ আটশ নয়শ'),
    credit_verbs: w('baki dhar dhaar udhar'),
    payment_verbs: w('jama shodh shodhlo ferot phirot porishodh'),
    give_verbs: w('diyeche dilo diyechilo dilam diyechi dibe debe dao dite'),
    take_verbs: w('niyeche nilo niyechilo nibe nebe'),
    yes: w('hyan hya ha haan thik accha ji'),
    no: w('na naa nah'),
    possessive: [], possessive_suffix: w('er'),
    agent: [], recipient: [], recipient_suffix: w('ke'), source: w('theke'),
    dates: { today: w('aaj aj'), yesterday: w('gotokal gatakal'), tomorrow: w('agamikal'), kal: w('kal kaal'), parso: w('porshu parshu') },
    past: w('chilo diyechilo diyeche dilo nilo niyeche niyechilo korechilo'),
    future: w('debe dibe dibo nebe korbe debo pabo'),
    first: w('prothom'), second: w('ditiyo'), third: w('tritiyo'),
    when: ['aaj', 'kal', 'porshu'],
    query: w('koto hisab total balance bolo'),
    undo: w('batil mucho undo cancel'),
    create: w('notun'),
    customer_nouns: w('customer khata khoddar'),
    reminder: w('reminder'),
    lending: w('rin sud loan emi interest kisti'),
    diagnosis: w('oshukh chikitsa diagnosis'),
    conj: w('ar aar tarpor ebong'),
    filler: w('ache achhe holo'),
    subject_first: true,
    templates: {
      disclosure: 'Nomoskar, ami AI sahayok. Kar hisab likhbo?',
      entry_credit: '{amount} baki',
      entry_payment: '{amount} jama',
      balance_due: '{name} er {amount} baki ache.',
      balance_advance: '{name} {amount} advance diyechen.',
      balance_zero: '{name} er hisab mile geche.',
      clarify_direction: '{name} diyechen, na {name} ke diyechen?',
      clarify_customer: 'Kar khatay?',
      clarify_amount: 'Koto taka?',
      clarify_repeat: 'Abar bolben?',
      disambiguate: 'Kon {name}: {options}?',
      saved: 'Likhe nilam.',
      refused_lending: 'Dukkhito, rin, sud, EMI er kaj kori na.',
      refused_diagnosis: 'Dukkhito, oshudher poramorsho dite pari na.',
      reminder: 'Nomoskar {name}, {amount} baki ache. Subidha moto shodh korben.',
      reminder_no_optin: '{name} reminder e raji hon ni.',
      promise_saved: 'Thik ache, {when} {amount} pawar kotha likhe rakhlam.',
      target_option: '{amount} takar ta',
      target_join: ' na ',
      clarify_future_credit: 'Baki ekhon dilen, na pore deben?',
    },
  },
  en: {
    name: 'English',
    credit_verbs: w('credit owes owe due'),
    payment_verbs: w('paid pay pays payment repaid returned deposited received'),
    give_verbs: w('gave give gives given'),
    take_verbs: w('took take takes taken bought'),
    yes: w('yes yeah yep ok okay correct right sure'),
    no: w('no nope wrong'),
    possessive: w('s of'), agent: [], recipient: [], source: [],
    prep_recipient: w('to'), prep_source: w('from'),
    dates: { today: w('today'), yesterday: w('yesterday'), tomorrow: w('tomorrow'), kal: [], parso: [] },
    past: w('was were gave took paid did had'),
    future: w('will shall gonna'),
    first: w('first'), second: w('second'), third: w('third'),
    when: ['today', 'tomorrow', 'the day after tomorrow'],
    query: w('total how much balance what'),
    undo: w('undo cancel delete remove scratch'),
    create: w('new add'),
    customer_nouns: w('customer account'),
    reminder: w('remind reminder reminders'),
    lending: w('loan interest emi lend lending'),
    diagnosis: w('diagnose diagnosis symptoms disease prescription'),
    conj: w('and then'),
    filler: w('the a an is has have for on in my his her me i he she it please this that does'),
    subject_first: true,
    templates: {
      disclosure: 'Hello, I am an AI assistant. Whose account?',
      entry_credit: '{amount} credit',
      entry_payment: '{amount} paid',
      balance_due: '{name} owes {amount}.',
      balance_advance: '{name} has paid {amount} in advance.',
      balance_zero: '{name} is fully settled.',
      clarify_direction: 'Did {name} pay you, or did you give to {name}?',
      clarify_customer: 'Which customer?',
      clarify_amount: 'How much?',
      clarify_repeat: 'Could you say that again?',
      disambiguate: 'Which {name}: {options}?',
      saved: 'Saved.',
      refused_lending: 'Sorry, I do not handle loans, interest or EMI.',
      refused_diagnosis: 'Sorry, I cannot give medical advice. Please ask a doctor.',
      reminder: 'Hello {name}, {amount} is due. Please pay when convenient.',
      reminder_no_optin: '{name} has not agreed to reminders.',
      promise_saved: 'Okay, noted that {amount} is promised {when}.',
      target_option: 'the {amount} one',
      target_join: ' or ',
      clarify_future_credit: 'Credit given now, or later?',
    },
  },
  // EXPERIMENTAL: lexicon-only for parsing. No templates; replies fall back to Hindi.
  bho: {
    name: 'Bhojpuri', experimental: true,
    credit_verbs: w('udhaar baaki'), payment_verbs: w('jama chukvlas chukawle'),
    give_verbs: w('dihlas dihle dihal dele'), take_verbs: w('lihlas lihle lel'),
    yes: w('haan ha'), no: w('na nahi'), possessive: w('ke kar'), agent: [], recipient: [], source: w('se'),
    dates: { today: w('aaju aaj'), yesterday: [], tomorrow: [], kal: w('kal kaalh'), parso: w('parson') },
    past: w('rahe dihlas lihlas'), future: w('dihi debe'),
    query: w('kettna ketna hisab'), undo: [], create: [], customer_nouns: [], reminder: [], lending: w('karja byaj'),
    diagnosis: [], conj: w('aur'), filler: w('ba baate'),
  },
  // EXPERIMENTAL: lexicon-only for parsing. No templates; replies fall back to Hindi.
  mai: {
    name: 'Maithili', experimental: true,
    credit_verbs: w('udhaar baaki'), payment_verbs: w('jama'),
    give_verbs: w('delak delakai del'), take_verbs: w('lelak lel'),
    yes: w('haan'), no: w('nai nahi'), possessive: w('ker k'), agent: [], recipient: [], source: w('sa'),
    dates: { today: w('aai'), yesterday: [], tomorrow: [], kal: w('kaali kalh'), parso: w('parsu') },
    past: w('chhal delak lelak'), future: w('debai deta'),
    query: w('kataek hisab'), undo: [], create: [], customer_nouns: [], reminder: [], lending: w('karja byaj'),
    diagnosis: [], conj: w('aar'), filler: w('achhi'),
  },
};

// Replies the server needs beyond intent templates (Latin). Kept here so server.js holds no user-facing text.
Object.assign(PACKS.hi.templates, {
  short_due: 'Baaki {amount}.', short_advance: 'Advance {amount}.', short_zero: 'Hisaab barabar.', tag_option: '{tag} wala',
  stop: '.',
  confirm_q: 'Sahi hai?', cancelled: 'Theek hai, nahi likha.', nothing: 'Abhi kuch pending nahi hai.',
  today: 'aaj', yesterday: 'kal', tomorrow: 'kal', day_after: 'parso',
  total: 'Dukaan ka kul baaki {amount} hai.', day_total: '{when} udhaar {credit}, jama {payment}.', undone: 'Pichhli entry hata di.',
  created: '{name} ka khata khul gaya.', optin: '{name} ke reminder ki anumati likh li.', error: 'Maaf kijiye, phir se boliye.',
});
Object.assign(PACKS.mr.templates, {
  short_due: 'Baki {amount}.', short_advance: 'Advance {amount}.', short_zero: 'Hishob barobar.', tag_option: '{tag} vala',
  stop: '.',
  confirm_q: 'Barobar?', cancelled: 'Theek aahe, lihile nahi.', nothing: 'Aata kahi baki nahi.',
  today: 'aaj', yesterday: 'kal', tomorrow: 'udya', day_after: 'parva', clarify_target: '{options}?',
  total: 'Dukanachi ekun baki {amount} aahe.', day_total: '{when} udhari {credit}, jama {payment}.', undone: 'Magchi nond kadhli.',
  created: '{name} cha khata ughadla.', optin: '{name} chya reminder chi parvangi lihili.', error: 'Maaf kara, parat sanga.',
});
Object.assign(PACKS.bn.templates, {
  short_due: 'Baki {amount}.', short_advance: 'Advance {amount}.', short_zero: 'Hisab mile geche.', tag_option: '{tag} wala',
  stop: '.',
  confirm_q: 'Thik ache?', cancelled: 'Thik ache, likhlam na.', nothing: 'Ekhon kichu baki nei.',
  today: 'aaj', yesterday: 'gotokal', tomorrow: 'agamikal', day_after: 'porshu', clarify_target: '{options}?',
  total: 'Dokaner mot baki {amount}.', day_total: '{when} baki {credit}, jama {payment}.', undone: 'Ager entry muchhe dilam.',
  created: '{name} er khata khola holo.', optin: '{name} er reminder er onumoti likhlam.', error: 'Dukkhito, abar bolun.',
});
Object.assign(PACKS.en.templates, {
  short_due: '{amount} due.', short_advance: '{amount} advance.', short_zero: 'Fully settled.', tag_option: 'the {tag} one',
  stop: '.',
  confirm_q: 'Correct?', cancelled: 'Okay, not saved.', nothing: 'Nothing pending.',
  today: 'today', yesterday: 'yesterday', tomorrow: 'tomorrow', day_after: 'the day after tomorrow', clarify_target: '{options}?',
  total: 'Total due to the shop is {amount}.', day_total: 'Credit {when} {credit}, payments {payment}.', undone: 'Removed the last entry.',
  created: 'Opened an account for {name}.', optin: 'Noted that {name} agreed to reminders.', error: 'Sorry, please say that again.',
});

// The same replies in native script (TTS_SCRIPT=native). English has none: it falls back to Latin.
PACKS.hi.native = {
  short_due: 'बाकी {amount}।', short_advance: 'एडवांस {amount}।', short_zero: 'हिसाब बराबर।', tag_option: '{tag} वाला',
  stop: '।',
  disclosure: 'नमस्ते, मैं AI सहायक हूँ। किसका हिसाब लिखूँ?',
  entry_credit: '{amount} उधार', entry_payment: '{amount} जमा',
  balance_due: '{name} का {amount} बाकी है।', balance_advance: '{name} ने {amount} एडवांस दिया है।', balance_zero: '{name} का हिसाब बराबर है।',
  clarify_direction: '{name} ने दिया, या {name} को दिया?', clarify_customer: 'किसके खाते में?', clarify_amount: 'कितने रुपये?',
  clarify_repeat: 'फिर से बोलिए?', disambiguate: 'कौन से {name}: {options}?', saved: 'लिख लिया।',
  refused_lending: 'माफ़ कीजिए, लोन, ब्याज, EMI का काम नहीं करता।',
  refused_diagnosis: 'माफ़ कीजिए, दवाई की सलाह नहीं दे सकता।',
  reminder: 'नमस्ते {name}, {amount} बाकी। जब सुविधा हो, चुका दीजिए।',
  reminder_no_optin: '{name} ने रिमाइंडर की अनुमति नहीं दी।',
  promise_saved: 'ठीक, {when} {amount} मिलने का नोट लिख दिया।', clarify_target: '{options}?', target_option: '{amount} वाला', target_join: 'या',
  clarify_future_credit: 'उधार अभी दिया, या बाद में देंगे?',
  confirm_q: 'सही है?', cancelled: 'ठीक है, नहीं लिखा।', nothing: 'अभी कुछ बाकी नहीं है।',
  today: 'आज', yesterday: 'कल', tomorrow: 'कल', day_after: 'परसों',
  total: 'दुकान का कुल बाकी {amount} है।', day_total: '{when} उधार {credit}, जमा {payment}।', undone: 'पिछली एंट्री हटा दी।',
  created: '{name} का खाता खुल गया।', optin: '{name} के रिमाइंडर की अनुमति लिख ली।', error: 'माफ़ कीजिए, फिर से बोलिए।',
};
// TODO native-speaker verify (Marathi)
PACKS.mr.native = {
  short_due: 'बाकी {amount}.', short_advance: 'ॲडव्हान्स {amount}.', short_zero: 'हिशोब बरोबर.', tag_option: '{tag} वाला',
  stop: '.',
  disclosure: 'नमस्कार, मी AI सहायक आहे. कोणाचा हिशोब लिहू?',
  entry_credit: '{amount} उधारी', entry_payment: '{amount} जमा',
  balance_due: '{name} ची {amount} बाकी आहे.', balance_advance: '{name} ने {amount} ॲडव्हान्स दिले आहेत.', balance_zero: '{name} चा हिशोब बरोबर आहे.',
  clarify_direction: '{name} ने दिले, की {name} ला दिले?', clarify_customer: 'कोणाच्या खात्यात?', clarify_amount: 'किती रुपये?',
  clarify_repeat: 'परत सांगा?', disambiguate: 'कोणता {name}: {options}?', saved: 'लिहून घेतले.',
  refused_lending: 'माफ करा, कर्ज, व्याज, EMI चे काम करत नाही.',
  refused_diagnosis: 'माफ करा, औषधाचा सल्ला देऊ शकत नाही.',
  reminder: 'नमस्कार {name}, {amount} बाकी आहे. सोयीनुसार भरावे.',
  reminder_no_optin: '{name} नी रिमाइंडरची परवानगी दिली नाही.',
  promise_saved: 'ठीक, {when} {amount} मिळण्याची नोंद केली.', clarify_target: '{options}?', target_option: '{amount} वाला', target_join: 'की',
  clarify_future_credit: 'उधारी आता दिली, की नंतर देणार?',
  confirm_q: 'बरोबर?', cancelled: 'ठीक आहे, लिहिले नाही.', nothing: 'आता काही बाकी नाही.',
  today: 'आज', yesterday: 'काल', tomorrow: 'उद्या', day_after: 'परवा',
  total: 'दुकानाची एकूण बाकी {amount} आहे.', day_total: '{when} उधारी {credit}, जमा {payment}.', undone: 'मागची नोंद काढली.',
  created: '{name} चा खाता उघडला.', optin: '{name} च्या रिमाइंडरची परवानगी लिहिली.', error: 'माफ करा, परत सांगा.',
};
// TODO native-speaker verify (Bengali)
PACKS.bn.native = {
  short_due: 'বাকি {amount}।', short_advance: 'অ্যাডভান্স {amount}।', short_zero: 'হিসাব মিলে গেছে।', tag_option: '{tag} ওয়ালা',
  stop: '।',
  disclosure: 'নমস্কার, আমি AI সহায়ক। কার হিসাব লিখব?',
  entry_credit: '{amount} বাকি', entry_payment: '{amount} জমা',
  balance_due: '{name} এর {amount} বাকি আছে।', balance_advance: '{name} {amount} অ্যাডভান্স দিয়েছেন।', balance_zero: '{name} এর হিসাব মিলে গেছে।',
  clarify_direction: '{name} দিয়েছেন, না {name} কে দিয়েছেন?', clarify_customer: 'কার খাতায়?', clarify_amount: 'কত টাকা?',
  clarify_repeat: 'আবার বলবেন?', disambiguate: 'কোন {name}: {options}?', saved: 'লিখে নিলাম।',
  refused_lending: 'দুঃখিত, ঋণ, সুদ, EMI এর কাজ করি না।',
  refused_diagnosis: 'দুঃখিত, ওষুধের পরামর্শ দিতে পারি না।',
  reminder: 'নমস্কার {name}, {amount} বাকি আছে। সুবিধামতো শোধ করবেন।',
  reminder_no_optin: '{name} রিমাইন্ডারে রাজি হননি।',
  promise_saved: 'ঠিক আছে, {when} {amount} পাওয়ার কথা লিখে রাখলাম।', clarify_target: '{options}?', target_option: '{amount} টাকার টা', target_join: 'না',
  clarify_future_credit: 'বাকি এখন দিলেন, না পরে দেবেন?',
  confirm_q: 'ঠিক আছে?', cancelled: 'ঠিক আছে, লিখলাম না।', nothing: 'এখন কিছু বাকি নেই।',
  today: 'আজ', yesterday: 'গতকাল', tomorrow: 'আগামীকাল', day_after: 'পরশু',
  total: 'দোকানের মোট বাকি {amount}।', day_total: '{when} বাকি {credit}, জমা {payment}।', undone: 'আগের এন্ট্রি মুছে দিলাম।',
  created: '{name} এর খাতা খোলা হলো।', optin: '{name} এর রিমাইন্ডারের অনুমতি লিখলাম।', error: 'দুঃখিত, আবার বলুন।',
};

const LIST_FIELDS = ['credit_verbs', 'payment_verbs', 'give_verbs', 'take_verbs', 'yes', 'no', 'possessive', 'possessive_suffix',
  'agent', 'agent_suffix', 'recipient', 'recipient_suffix', 'source', 'prep_recipient', 'prep_source', 'past', 'future', 'query',
  'undo', 'create', 'customer_nouns', 'reminder', 'lending', 'diagnosis', 'conj', 'filler', 'wala', 'first', 'second', 'third'];
const DATE_KEYS = ['today', 'yesterday', 'tomorrow', 'kal', 'parso'];
const SUFFIX_FIELDS = new Set(['possessive_suffix', 'agent_suffix', 'recipient_suffix']);

// ONE merged union lexicon for parsing (Sets). UNION.all = every standalone lexicon word.
const UNION = {};
for (const f of LIST_FIELDS) UNION[f] = new Set(Object.values(PACKS).flatMap((p) => p[f] || []));
for (const d of DATE_KEYS) UNION[d] = new Set(Object.values(PACKS).flatMap((p) => p.dates[d]));
UNION.all = new Set([...LIST_FIELDS.filter((f) => !SUFFIX_FIELDS.has(f)), ...DATE_KEYS].flatMap((f) => [...UNION[f]]));

const packWords = Object.fromEntries(Object.entries(PACKS).map(([k, p]) =>
  [k, new Set([...LIST_FIELDS.flatMap((f) => p[f] || []), ...DATE_KEYS.flatMap((d) => p.dates[d])])]));

// Reply language only. Ties go to Hindi (first pack). score = how many lexicon words that pack matched.
function detectLangScore(words) {
  let best = 'hi', score = 0;
  for (const [k, set] of Object.entries(packWords)) {
    const s = words.filter((x) => set.has(x)).length;
    if (s > score) { best = k; score = s; }
  }
  return { lang: best, score };
}
const detectLang = (words) => detectLangScore(words).lang;

// script: 'latin' (default) or 'native'. Packs without templates (bho, mai) reply in Hindi.
function render(lang, key, vars = {}, script = 'latin') {
  const P = PACKS[lang] && PACKS[lang].templates ? PACKS[lang] : PACKS.hi;
  const t = (script === 'native' && P.native && P.native[key]) || P.templates[key]
    || (script === 'native' && P === PACKS.hi && PACKS.hi.native[key]) || PACKS.hi.templates[key];
  if (!t) throw new Error(`no template ${key}`);
  return t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])))
    .replace(/\s{2,}/g, ' ').replace(/\s+([.,?।])/g, '$1').trim(); // empty vars leave no stray spaces
}

// Spoken day word relative to today: -1 yesterday, 0 today, 1 tomorrow, 2 day after. null if no word exists.
const DAY_KEYS = { '-1': 'yesterday', 0: 'today', 1: 'tomorrow', 2: 'day_after' };
const dayWord = (lang, offset, script = 'latin') => (DAY_KEYS[offset] ? render(lang, DAY_KEYS[offset], {}, script) : null);

// Resolve a (possibly transliterated) token to a lexicon word: EXACT, then light key (long vowels), then canonical key.
// A key shared by words with different roles (ka/ko/ke all fold to "k") resolves to nothing.
const ROLE_FIELDS = [...LIST_FIELDS.filter((f) => !SUFFIX_FIELDS.has(f)), ...DATE_KEYS];
const role = (word) => ROLE_FIELDS.filter((f) => UNION[f].has(word)).join(',');
function indexBy(keyFn) {
  const m = new Map();
  for (const word of UNION.all) { const k = keyFn(word); if (!m.has(k)) m.set(k, []); m.get(k).push(word); }
  return m;
}
const LIGHT = indexBy(lightKey), CANON = indexBy(canonicalKey);
const resolve = (m, k) => { const ws = m.get(k); return ws && new Set(ws.map(role)).size === 1 ? ws[0] : null; };
function lexWord(w) {
  if (UNION.all.has(w)) return w;
  const light = [...w].length >= 3 && resolve(LIGHT, lightKey(w)); // "aa" must not become English "a"
  if (light) return light;
  const c = canonicalKey(w);
  // shortcut: canonical keys under 4 chars are too collision-prone (Kalu -> kal); revisit with real ASR logs.
  return c.length >= 4 ? resolve(CANON, c) : null;
}

module.exports = { PACKS, UNION, detectLang, detectLangScore, render, dayWord, lexWord };
