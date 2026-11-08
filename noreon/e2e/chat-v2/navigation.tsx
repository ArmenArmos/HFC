import React from 'react';
export const usePathname = () => window.location.pathname;
const navigate = (url: string) => {
  document.documentElement.setAttribute('data-fixture-navigation', url);
};
export const useRouter = () => ({ push:navigate, replace:navigate, refresh:() => {} });
export default function Link(props: React.ComponentProps<'a'>) { return <a {...props} />; }
