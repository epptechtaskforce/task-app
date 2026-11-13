// Deployment settings. Loaded before the app.
//   backendUrl : the Apps Script web app URL (ends with /exec). Not a secret: every call needs a login.
//   demo       : true = run entirely in the browser with fake data (nothing is sent anywhere).
//   demoAi     : true = in demo mode, let the real AI model answer from the demo data (needs backendUrl and the backend's demoAi relay;
//                it is public and capped, see A.demoAi in Core.gs). Leave out to use the simple built-in stand-in.
// Tip: open the site with ?demo=1 to try the demo without changing this file.
window.APP_CONFIG = {
  backendUrl: 'https://script.google.com/macros/s/AKfycbzC8KekaupR2bBb_AZnoUQbIhDMy2Xubgk0FqycU37hT7_0fuKWv5q8ggk4bc2cLECIQg/exec',
  demo: false
};
