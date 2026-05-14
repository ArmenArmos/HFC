// Minimal hairline icon set — line-only, 1.5 stroke, lucide-style.
// Each is a function ({size, color, strokeWidth}) => SVG element.

const _icon = (paths) => function I({ size = 18, color = "currentColor", strokeWidth = 1.5, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
         style={style} aria-hidden="true">
      {paths}
    </svg>
  );
};

const IconSparkles = _icon(<>
  <path d="M12 3v3M12 18v3M5 12H2M22 12h-3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/>
  <path d="M12 8.5l1.2 2.3L15.5 12l-2.3 1.2L12 15.5l-1.2-2.3L8.5 12l2.3-1.2L12 8.5z"/>
</>);
const IconMoon = _icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>);
const IconFootprints = _icon(<><path d="M4 16a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1a4 4 0 0 1-2 3.5L6 21V16zM15 16a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1a4 4 0 0 1-2 3.5L17 21V16z"/><ellipse cx="7" cy="6" rx="2" ry="3"/><ellipse cx="17" cy="9" rx="2" ry="3"/></>);
const IconUtensils = _icon(<><path d="M3 3v6a3 3 0 0 0 3 3v9M9 3v6a3 3 0 0 1-3 3"/><path d="M14 3h4a3 3 0 0 1 0 6h-1v12"/></>);
const IconActivity = _icon(<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>);
const IconDroplet = _icon(<path d="M12 2.5s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z"/>);
const IconWind = _icon(<><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/></>);
const IconChat = _icon(<path d="M21 11.5a8.4 8.4 0 0 1-3.5 6.8l-1 3.7-3.7-1A8.5 8.5 0 1 1 21 11.5z"/>);
const IconCalendar = _icon(<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>);
const IconChevron = _icon(<path d="M9 6l6 6-6 6"/>);
const IconCamera = _icon(<><path d="M14.5 4h-5l-2 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5l-2-2z"/><circle cx="12" cy="13" r="3.5"/></>);
const IconCheck = _icon(<path d="M5 12l5 5 9-11"/>);
const IconArrow = _icon(<><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></>);
const IconBack = _icon(<><path d="M19 12H5"/><path d="M11 5l-7 7 7 7"/></>);
const IconPlus = _icon(<><path d="M12 5v14M5 12h14"/></>);
const IconClose = _icon(<><path d="M18 6L6 18M6 6l12 12"/></>);
const IconLock = _icon(<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>);
const IconHome = _icon(<><path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/></>);
const IconTarget = _icon(<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>);
const IconLab = _icon(<><path d="M9 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-10V3"/><path d="M7 3h10"/></>);
const IconUser = _icon(<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>);
const IconSlider = _icon(<><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="#F4F1ED"/><circle cx="16" cy="12" r="2" fill="#F4F1ED"/><circle cx="7" cy="18" r="2" fill="#F4F1ED"/></>);

Object.assign(window, {
  IconSparkles, IconMoon, IconFootprints, IconUtensils, IconActivity, IconDroplet, IconWind, IconChat,
  IconCalendar, IconChevron, IconCamera, IconCheck, IconArrow, IconBack, IconPlus, IconClose, IconLock,
  IconHome, IconTarget, IconLab, IconUser, IconSlider,
});
