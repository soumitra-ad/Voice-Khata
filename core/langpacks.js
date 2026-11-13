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
      disclosure: 'Namaste! Main ek AI sahayak hoon, insaan nahi. Bataiye, kiska hisaab likhna hai?',
      entry_credit: '{name} ko {amount} udhaar',
      entry_payment: '{name} ne {amount} jama kiye',
      readback: '{entries}. {name} ka naya baaki {balance}. Sahi hai?',
      balance_due: '{name} ka {amount} baaki hai.',
      balance_advance: '{name} ne {amount} advance diya hai.',
      balance_zero: '{name} ka hisaab barabar hai.',
      clarify_direction: '{name} ne diya, ya {name} ko diya?',
      clarify_customer: 'Kiske khaate mein?',
      clarify_amount: 'Kitne rupaye?',
      clarify_repeat: 'Phir se boliye?',
      disambiguate: 'Kaunse {name}: {options}?',
      saved: 'Likh liya.',
      refused_lending: 'Maaf kijiye, main loan, byaaj ya EMI ka kaam nahi karta. Sirf dukaan ka khata.',
      refused_diagnosis: 'Maaf kijiye, main bimari ya dawai ki salah nahi de sakta. Doctor se poochhiye.',
      reminder: 'Namaste {name}, aapke khaate mein {amount} baaki hai. Jab suvidha ho, chuka dijiye. Dhanyavaad.',
      reminder_no_optin: '{name} ne reminder ke liye haan nahi kaha hai, isliye reminder nahi bhejunga.',
      promise_saved: 'Theek, {when} {amount} milne ka note likh diya.',
      clarify_target: '{options}?',
      target_option: '{amount} wala',
      target_join: ' ya ',
      clarify_future_credit: 'Udhaar abhi diya, ya baad mein denge?',
    },
  },
  mr: {
    name: 'Marathi',
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
      disclosure: 'Namaskar! Mi ek AI sahayak aahe, manus nahi. Sanga, konacha hishob lihaycha?',
      entry_credit: '{name} la {amount} udhari',
      entry_payment: '{name} ne {amount} jama kele',
      readback: '{entries}. {name} chi navin baki {balance}. Barobar?',
      balance_due: '{name} chi {amount} baki aahe.',
      balance_advance: '{name} ne {amount} advance dile aahet.',
      balance_zero: '{name} cha hishob barobar aahe.',
      clarify_direction: '{name} ne dile, ki {name} la dile?',
      clarify_customer: 'Konachya khatyat?',
      clarify_amount: 'Kiti rupaye?',
      clarify_repeat: 'Parat sanga?',
      disambiguate: 'Konta {name}: {options}?',
      saved: 'Lihun ghetle.',
      refused_lending: 'Maaf kara, mi karj, vyaj kiva EMI che kaam karat nahi. Fakta dukanacha khata.',
      refused_diagnosis: 'Maaf kara, mi aajar kiva aushadhacha salla deu shakat nahi. Doctor la vichara.',
      reminder: 'Namaskar {name}, tumchya khatyat {amount} baki aahe. Soyi asel tevha bharave. Dhanyavad.',
      reminder_no_optin: '{name} ni reminder sathi ho mhatle nahi, mhanun reminder pathavnar nahi.',
      promise_saved: 'Theek, {when} {amount} milnyachi nond keli.',
      target_option: '{amount} vala',
      target_join: ' ki ',
      clarify_future_credit: 'Udhari aata dili, ki nantar denar?',
    },
  },
  bn: {
    name: 'Bengali',
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
      disclosure: 'Nomoskar! Ami ekti AI sahayok, manush noi. Bolun, kar hisab likhbo?',
      entry_credit: '{name} ke {amount} baki',
      entry_payment: '{name} {amount} jama dilen',
      readback: '{entries}. {name} er notun baki {balance}. Thik ache?',
      balance_due: '{name} er {amount} baki ache.',
      balance_advance: '{name} {amount} advance diyechen.',
      balance_zero: '{name} er hisab mile geche.',
      clarify_direction: '{name} diyechen, na {name} ke diyechen?',
      clarify_customer: 'Kar khatay?',
      clarify_amount: 'Koto taka?',
      clarify_repeat: 'Abar bolben?',
      disambiguate: 'Kon {name}: {options}?',
      saved: 'Likhe nilam.',
      refused_lending: 'Dukkhito, ami rin, sud ba EMI er kaj kori na. Shudhu dokaner khata.',
      refused_diagnosis: 'Dukkhito, ami oshukh ba oshudher poramorsho dite pari na. Doctor ke jiggesh korun.',
      reminder: 'Nomoskar {name}, apnar khatay {amount} baki ache. Subidha moto shodh korben. Dhonnobad.',
      reminder_no_optin: '{name} reminder er jonno raji hon ni, tai reminder pathabo na.',
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
      disclosure: 'Hello! I am an AI assistant, not a person. Whose account should I update?',
      entry_credit: '{amount} credit to {name}',
      entry_payment: '{amount} paid by {name}',
      readback: '{entries}. {name} now owes {balance}. Correct?',
      balance_due: '{name} owes {amount}.',
      balance_advance: '{name} has paid {amount} in advance.',
      balance_zero: '{name} is fully settled.',
      clarify_direction: 'Did {name} pay you, or did you give to {name}?',
      clarify_customer: 'Which customer?',
      clarify_amount: 'How much?',
      clarify_repeat: 'Could you say that again?',
      disambiguate: 'Which {name}: {options}?',
      saved: 'Saved.',
      refused_lending: 'Sorry, I do not handle loans, interest or EMI. Only the shop ledger.',
      refused_diagnosis: 'Sorry, I cannot give medical advice. Please ask a doctor.',
      reminder: 'Hello {name}, your account shows {amount} due. Please settle when convenient. Thank you.',
      reminder_no_optin: '{name} has not agreed to reminders, so I will not send one.',
      promise_saved: 'Okay, noted that {amount} is promised {when}.',
      target_option: 'the {amount} one',
      target_join: ' or ',
      clarify_future_credit: 'Did you give the credit already, or will you give it later?',
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
  stop: '.',
  confirm_q: 'Sahi hai?', cancelled: 'Theek hai, nahi likha.', nothing: 'Abhi kuch pending nahi hai.',
  today: 'aaj', yesterday: 'kal', tomorrow: 'kal', day_after: 'parso',
  total: 'Dukaan ka kul baaki {amount} hai.', day_total: '{when} udhaar {credit}, jama {payment}.', undone: 'Pichhli entry hata di.',
  created: '{name} ka khata khul gaya.', optin: '{name} ke reminder ki anumati likh li.', error: 'Maaf kijiye, phir se boliye.',
});
Object.assign(PACKS.mr.templates, {
  stop: '.',
  confirm_q: 'Barobar?', cancelled: 'Theek aahe, lihile nahi.', nothing: 'Aata kahi baki nahi.',
  today: 'aaj', yesterday: 'kal', tomorrow: 'udya', day_after: 'parva', clarify_target: '{options}?',
  total: 'Dukanachi ekun baki {amount} aahe.', day_total: '{when} udhari {credit}, jama {payment}.', undone: 'Magchi nond kadhli.',
  created: '{name} cha khata ughadla.', optin: '{name} chya reminder chi parvangi lihili.', error: 'Maaf kara, parat sanga.',
});
Object.assign(PACKS.bn.templates, {
  stop: '.',
  confirm_q: 'Thik ache?', cancelled: 'Thik ache, likhlam na.', nothing: 'Ekhon kichu baki nei.',
  today: 'aaj', yesterday: 'gotokal', tomorrow: 'agamikal', day_after: 'porshu', clarify_target: '{options}?',
  total: 'Dokaner mot baki {amount}.', day_total: '{when} baki {credit}, jama {payment}.', undone: 'Ager entry muchhe dilam.',
  created: '{name} er khata khola holo.', optin: '{name} er reminder er onumoti likhlam.', error: 'Dukkhito, abar bolun.',
});
Object.assign(PACKS.en.templates, {
  stop: '.',
  confirm_q: 'Correct?', cancelled: 'Okay, not saved.', nothing: 'Nothing pending.',
  today: 'today', yesterday: 'yesterday', tomorrow: 'tomorrow', day_after: 'the day after tomorrow', clarify_target: '{options}?',
  total: 'Total due to the shop is {amount}.', day_total: 'Credit {when} {credit}, payments {payment}.', undone: 'Removed the last entry.',
  created: 'Opened an account for {name}.', optin: 'Noted that {name} agreed to reminders.', error: 'Sorry, please say that again.',
});

// The same replies in native script (TTS_SCRIPT=native). English has none: it falls back to Latin.
PACKS.hi.native = {
  stop: '।',
  disclosure: 'नमस्ते! मैं एक AI सहायक हूँ, इंसान नहीं। बताइए, किसका हिसाब लिखना है?',
  entry_credit: '{name} को {amount} उधार', entry_payment: '{name} ने {amount} जमा किए',
  readback: '{entries}। {name} का नया बाकी {balance}। सही है?',
  balance_due: '{name} का {amount} बाकी है।', balance_advance: '{name} ने {amount} एडवांस दिया है।', balance_zero: '{name} का हिसाब बराबर है।',
  clarify_direction: '{name} ने दिया, या {name} को दिया?', clarify_customer: 'किसके खाते में?', clarify_amount: 'कितने रुपये?',
  clarify_repeat: 'फिर से बोलिए?', disambiguate: 'कौन से {name}: {options}?', saved: 'लिख लिया।',
  refused_lending: 'माफ़ कीजिए, मैं लोन, ब्याज या EMI का काम नहीं करता। सिर्फ़ दुकान का खाता।',
  refused_diagnosis: 'माफ़ कीजिए, मैं बीमारी या दवाई की सलाह नहीं दे सकता। डॉक्टर से पूछिए।',
  reminder: 'नमस्ते {name}, आपके खाते में {amount} बाकी है। जब सुविधा हो, चुका दीजिए। धन्यवाद।',
  reminder_no_optin: '{name} ने रिमाइंडर के लिए हाँ नहीं कहा है, इसलिए रिमाइंडर नहीं भेजूँगा।',
  promise_saved: 'ठीक, {when} {amount} मिलने का नोट लिख दिया।', clarify_target: '{options}?', target_option: '{amount} वाला', target_join: 'या',
  clarify_future_credit: 'उधार अभी दिया, या बाद में देंगे?',
  confirm_q: 'सही है?', cancelled: 'ठीक है, नहीं लिखा।', nothing: 'अभी कुछ बाकी नहीं है।',
  today: 'आज', yesterday: 'कल', tomorrow: 'कल', day_after: 'परसों',
  total: 'दुकान का कुल बाकी {amount} है।', day_total: '{when} उधार {credit}, जमा {payment}।', undone: 'पिछली एंट्री हटा दी।',
  created: '{name} का खाता खुल गया।', optin: '{name} के रिमाइंडर की अनुमति लिख ली।', error: 'माफ़ कीजिए, फिर से बोलिए।',
};
// TODO native-speaker verify (Marathi)
PACKS.mr.native = {
  stop: '.',
  disclosure: 'नमस्कार! मी एक AI सहायक आहे, माणूस नाही. सांगा, कोणाचा हिशोब लिहायचा?',
  entry_credit: '{name} ला {amount} उधारी', entry_payment: '{name} ने {amount} जमा केले',
  readback: '{entries}. {name} ची नवीन बाकी {balance}. बरोबर?',
  balance_due: '{name} ची {amount} बाकी आहे.', balance_advance: '{name} ने {amount} ॲडव्हान्स दिले आहेत.', balance_zero: '{name} चा हिशोब बरोबर आहे.',
  clarify_direction: '{name} ने दिले, की {name} ला दिले?', clarify_customer: 'कोणाच्या खात्यात?', clarify_amount: 'किती रुपये?',
  clarify_repeat: 'परत सांगा?', disambiguate: 'कोणता {name}: {options}?', saved: 'लिहून घेतले.',
  refused_lending: 'माफ करा, मी कर्ज, व्याज किंवा EMI चे काम करत नाही. फक्त दुकानाचा खाता.',
  refused_diagnosis: 'माफ करा, मी आजार किंवा औषधाचा सल्ला देऊ शकत नाही. डॉक्टरला विचारा.',
  reminder: 'नमस्कार {name}, तुमच्या खात्यात {amount} बाकी आहे. सोयीनुसार भरावे. धन्यवाद.',
  reminder_no_optin: '{name} नी रिमाइंडरसाठी हो म्हटले नाही, म्हणून रिमाइंडर पाठवणार नाही.',
  promise_saved: 'ठीक, {when} {amount} मिळण्याची नोंद केली.', clarify_target: '{options}?', target_option: '{amount} वाला', target_join: 'की',
  clarify_future_credit: 'उधारी आता दिली, की नंतर देणार?',
  confirm_q: 'बरोबर?', cancelled: 'ठीक आहे, लिहिले नाही.', nothing: 'आता काही बाकी नाही.',
  today: 'आज', yesterday: 'काल', tomorrow: 'उद्या', day_after: 'परवा',
  total: 'दुकानाची एकूण बाकी {amount} आहे.', day_total: '{when} उधारी {credit}, जमा {payment}.', undone: 'मागची नोंद काढली.',
  created: '{name} चा खाता उघडला.', optin: '{name} च्या रिमाइंडरची परवानगी लिहिली.', error: 'माफ करा, परत सांगा.',
};
// TODO native-speaker verify (Bengali)
PACKS.bn.native = {
  stop: '।',
  disclosure: 'নমস্কার! আমি একটি AI সহায়ক, মানুষ নই। বলুন, কার হিসাব লিখব?',
  entry_credit: '{name} কে {amount} বাকি', entry_payment: '{name} {amount} জমা দিলেন',
  readback: '{entries}। {name} এর নতুন বাকি {balance}। ঠিক আছে?',
  balance_due: '{name} এর {amount} বাকি আছে।', balance_advance: '{name} {amount} অ্যাডভান্স দিয়েছেন।', balance_zero: '{name} এর হিসাব মিলে গেছে।',
  clarify_direction: '{name} দিয়েছেন, না {name} কে দিয়েছেন?', clarify_customer: 'কার খাতায়?', clarify_amount: 'কত টাকা?',
  clarify_repeat: 'আবার বলবেন?', disambiguate: 'কোন {name}: {options}?', saved: 'লিখে নিলাম।',
  refused_lending: 'দুঃখিত, আমি ঋণ, সুদ বা EMI এর কাজ করি না। শুধু দোকানের খাতা।',
  refused_diagnosis: 'দুঃখিত, আমি অসুখ বা ওষুধের পরামর্শ দিতে পারি না। ডাক্তারকে জিজ্ঞেস করুন।',
  reminder: 'নমস্কার {name}, আপনার খাতায় {amount} বাকি আছে। সুবিধামতো শোধ করবেন। ধন্যবাদ।',
  reminder_no_optin: '{name} রিমাইন্ডারের জন্য রাজি হননি, তাই রিমাইন্ডার পাঠাব না।',
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

// Reply language only. Ties go to Hindi (first pack).
function detectLang(words) {
  let best = 'hi', score = 0;
  for (const [k, set] of Object.entries(packWords)) {
    const s = words.filter((x) => set.has(x)).length;
    if (s > score) { best = k; score = s; }
  }
  return best;
}

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

module.exports = { PACKS, UNION, detectLang, render, dayWord, lexWord };
