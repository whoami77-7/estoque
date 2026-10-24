// Public product facts checked against each linked Rio Paraná page on 2026-10-24.
// A missing field is unknown or conflicting; it is never a default or a negative claim.
// Prices, availability, installation kits, warranty and internal stock data are deliberately absent.
export const RIO_CATALOG = [
  {
    id: '26611', brand: 'Conlux', model: 'PLAT-1211060', name: 'Conlux Split PLAT-1211060 12.000 BTUs',
    btu: 12000, voltage: '110 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-conlux-plat-1211060-12000btu-quente-frio-com-kit-wifi-110v-60hz', verifiedAt: '2026-10-24',
  },
  {
    id: '25188', brand: 'Conlux', model: 'TIT-1222060', name: 'Conlux Split TIT-1222060 12.000 BTUs',
    btu: 12000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-conlux-12000-btu-quentefrio-wifi-220v60hz-com-kit', verifiedAt: '2026-10-24',
  },
  {
    // Title and technical table disagree on TIT-1222060 versus TITPLUS-1222060.
    id: '26666', brand: 'Conlux', name: 'Conlux Split Plus 12.000 BTUs',
    btu: 12000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-conlux-plus-tit-1222060-12000btu-quente-frio-com-kit-wifi-220v-60hz', verifiedAt: '2026-10-24',
  },
  {
    id: '26512', brand: 'Conlux', model: 'TIT-1822060', name: 'Conlux Split Titanium 18.000 BTUs',
    btu: 18000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-conlux-tit-1822060-18000btu-quente-frio-com-kit-wifi-220v-60hz', verifiedAt: '2026-10-24',
  },
  {
    // The hero says 60 Hz; title/table say 50/60 Hz. Leave frequency for label confirmation.
    id: '30144', brand: 'Conlux', model: 'ECO-1222050/60', name: 'Conlux Split Economy 12.000 BTUs Inverter',
    btu: 12000, voltage: '220 V', technology: 'Inverter', cycle: 'Quente e frio', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-inverter-conlux-12000btu-quentefrio-com-wifi-bi-hertz-5060hz-eco-122205060', verifiedAt: '2026-10-24',
  },
  {
    // The hero says 60 Hz; title/table say 50 Hz.
    id: '27007', brand: 'Conlux', model: 'PRE-1222050', name: 'Conlux Split Premium 12.000 BTUs',
    btu: 12000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-conlux-pre-1222050-12000btu-quente-frio-com-kit-wifi-220v-50hz', verifiedAt: '2026-10-24',
  },
  {
    id: '31141', brand: 'Gree', model: 'GWH12ATBXA-D6DNA1A/I', name: 'Gree Split 12.000 BTUs Inverter',
    btu: 12000, voltage: '220 V', technology: 'Inverter', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-gree-12000btu-inverter-quente-frio-com-kit-wifi-r32-220v-60hz', verifiedAt: '2026-10-24',
  },
  {
    id: '6194', brand: 'Gree', model: 'GWH12ATDXB-S3DNA1A/0', name: 'Gree Split 12.000 BTUs Inverter',
    btu: 12000, voltage: '220 V', technology: 'Inverter', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-gree-12000btu-quente-frio-sem-kit-wifi-220v-60hz-inverter', verifiedAt: '2026-10-24',
  },
  {
    id: '23627', brand: 'Gree', model: 'GWH18ATDXB-S3DNA1A/0', name: 'Gree Split D3 18.000 BTUs Inverter',
    btu: 18000, voltage: '220 V', technology: 'Inverter', cycle: 'Quente e frio', frequency: '60 Hz', wifi: true,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-gree-d3-18000btu-quente-frio-sem-kit-220v-60hz-inverter', verifiedAt: '2026-10-24',
  },
  {
    id: '30823', brand: 'Sleiman', model: 'TEX-12K', name: 'Sleiman Split TEX-12K 12.000 BTUs',
    btu: 12000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '60 Hz', wifi: false,
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-sleiman-tex-12k-12000btu-220v-60hz-quente-e-frio-com-kit-de-instalcaao', verifiedAt: '2026-10-24',
  },
  {
    // Summary says TAC-12CHSA/XA91; table adds INV. Do not emit a manufacturer code.
    id: '22996', brand: 'TCL', name: 'TCL Split 12.000 BTUs Convencional',
    btu: 12000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '60 Hz', wifi: false,
    sourceUrl: 'https://rioparana.com.py/product/ar-split-tcl-12000-btu-12chsaxa91-qf-com-kit-220v60hz', verifiedAt: '2026-10-24',
  },
  {
    id: '26956', brand: 'TCL', model: 'TAC-12CHSA/XA73', name: 'TCL Split XA73 12.000 BTUs Convencional',
    btu: 12000, voltage: '220 V', technology: 'Convencional', cycle: 'Quente e frio', frequency: '50 Hz',
    sourceUrl: 'https://rioparana.com.py/product/ar-condicionado-split-tcl-12000btu-tac-12chsaxa73-quente-frio-com-kit-220v-50hz', verifiedAt: '2026-10-24',
  },
];
