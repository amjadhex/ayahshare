// www.ayahshare.com → ayahshare.com (one host: one sign-in cookie, one service worker, one cache).
export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(`https://ayahshare.com${url.pathname}${url.search}`, 301);
  },
};
