(function(){
  "use strict";
  const BASE="./";
  const THEMES={
    fastfood:{image:"theme-fastfood.webp",accent:"#b91c1c",icon:"🍔"},
    cafe:{image:"theme-cafe.webp",accent:"#7c2d12",icon:"☕"},
    pizza:{image:"theme-pizza.webp",accent:"#c2410c",icon:"🍕"},
    dessert:{image:"theme-dessert.webp",accent:"#be185d",icon:"🍰"},
    bakery:{image:"theme-bakery.webp",accent:"#b45309",icon:"🥐"},
    grocery:{image:"theme-grocery.webp",accent:"#15803d",icon:"🛒"},
    taxi:{image:"theme-taxi.webp",accent:"#ca8a04",icon:"🚕"},
    delivery:{image:"theme-delivery.webp",accent:"#ea580c",icon:"🛵"},
    parcel:{image:"theme-parcel.webp",accent:"#d97706",icon:"📦"},
    retail:{image:"theme-retail.webp",accent:"#7e22ce",icon:"🛍️"},
    pharmacy:{image:"theme-pharmacy.webp",accent:"#0f766e",icon:"💊"},
    clinic:{image:"theme-clinic.webp",accent:"#0369a1",icon:"🩺"},
    maintenance:{image:"theme-maintenance.webp",accent:"#334155",icon:"🔧"},
    plumbing:{image:"theme-plumbing.webp",accent:"#0284c7",icon:"🚰"},
    electrical:{image:"theme-electrical.webp",accent:"#ca8a04",icon:"💡"},
    ac:{image:"theme-ac.webp",accent:"#0284c7",icon:"❄️"},
    cleaning:{image:"theme-cleaning.webp",accent:"#0891b2",icon:"🧼"},
    pest:{image:"theme-pest.webp",accent:"#9f1239",icon:"🛡️"},
    salon:{image:"theme-salon.webp",accent:"#be185d",icon:"✂️"},
    spa:{image:"theme-spa.webp",accent:"#7e22ce",icon:"🪷"},
    fitness:{image:"theme-fitness.webp",accent:"#991b1b",icon:"🏋️"},
    carwash:{image:"theme-carwash.webp",accent:"#0369a1",icon:"🚗"},
    pets:{image:"theme-pets.webp",accent:"#a16207",icon:"🐾"},
    travel:{image:"theme-travel.webp",accent:"#1d4ed8",icon:"🧳"}
  };
  function normalize(value){
    return String(value||"").toLowerCase().replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/ى/g,"ي").replace(/[ًٌٍَُِّْـ]/g,"").replace(/\s+/g," ").trim();
  }
  function payloadText(input={}){
    const itemText=Array.isArray(input.items)?input.items.slice(0,12).map(x=>x?.name||x).join(" "):"";
    return normalize([input.category,input.serviceType,input.profession,input.description,itemText].filter(Boolean).join(" "));
  }
  function has(text,terms){return terms.some(term=>text.includes(normalize(term)));}
  function resolve(input={}){
    const category=normalize(input.category||input.serviceType||"");
    const text=payloadText(input);
    let key="parcel";
    if(has(text,["بيتزا","pizza"])) key="pizza";
    else if(has(text,["مقهي","كافيه","كوفي","قهوه","coffee","cafe"])) key="cafe";
    else if(has(text,["حلويات","كيك","كعك","ايس كريم","ايسكريم","dessert","cake"])) key="dessert";
    else if(has(text,["مخبز","مخبوزات","معجنات","خبز","bakery"])) key="bakery";
    else if(category==="restaurant"||has(text,["مطعم","ماكولات","وجبات","برغر","برجر","شاورما","كباب","food","restaurant"])) key="fastfood";
    else if(category==="grocery"||has(text,["بقاله","سوبرماركت","ماركت","مواد غذائيه","خضار","فواكه","grocery"])) key="grocery";
    else if(has(text,["صيدليه","ادويه","دواء","pharmacy"])) key="pharmacy";
    else if(category==="health"||has(text,["صحه","عياده","طبيب","طب","مختبر","اسنان","تمريض","clinic","medical"])) key="clinic";
    else if(has(text,["سباك","سباكه","ماء","حنفيه","plumb"])) key="plumbing";
    else if(has(text,["كهربائي","كهرباء","اناره","مولده","electrical"])) key="electrical";
    else if(has(text,["تكييف","تبريد","مكيف","سبلت","ac ","air condition"])) key="ac";
    else if(has(text,["تنظيف","غسيل منزل","تعقيم","cleaning"])) key="cleaning";
    else if(has(text,["حشرات","مكافحه","رش","pest"])) key="pest";
    else if(has(text,["صالون","حلاق","حلاقه","شعر","barber","salon"])) key="salon";
    else if(has(text,["سبا","مساج","عنايه بالبشره","spa","massage"])) key="spa";
    else if(has(text,["نادي","لياقه","رياضه","جيم","gym","fitness"])) key="fitness";
    else if(has(text,["غسيل سيارات","غسيل سياره","كارواش","car wash"])) key="carwash";
    else if(has(text,["حيوانات","بيطري","قطط","كلاب","pet","veterinary"])) key="pets";
    else if(has(text,["سفر","سياحه","فندق","حجز","travel","hotel"])) key="travel";
    else if(has(text,["تاكسي","تكسي","سياره اجره","taxi"])) key="taxi";
    else if(has(text,["توصيل","مندوب","دلفري","delivery"])) key="delivery";
    else if(has(text,["طرود","شحن","طرد","parcel","shipping"])) key="parcel";
    else if(category==="retail"||has(text,["تسوق","متجر","ملابس","الكترونيات","اكسسوارات","اثاث","بيع","retail","shop"])) key="retail";
    else if(category==="maintenance"||has(text,["صيانه","اصلاح","ميكانيكي","نجار","حداد","فني","repair","maintenance"])) key="maintenance";
    else if(category==="home"||has(text,["خدمات منزليه","منزليه","house","home service"])) key="cleaning";
    const theme=THEMES[key]||THEMES.parcel;
    return {key,image:`${BASE}${theme.image}?v=67`,accent:theme.accent,icon:theme.icon};
  }
  function cssVars(input={}){
    const t=resolve(input);
    return `--karwa-service-theme:url('${t.image}');--karwa-service-accent:${t.accent};`;
  }
  window.KarwaServiceThemes={themes:THEMES,resolve,cssVars,version:65};
})();
