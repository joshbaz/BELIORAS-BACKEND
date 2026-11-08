/* Status Page */

/**
 * What a browser sees at / and /status: a page saying the API is up, like the
 * Artistry360 server's. API clients asking for JSON get the JSON instead (see
 * app.js), so monitoring and scripts are unaffected. The logo and favicon are
 * served from server/public.
 */
export const statusPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Belioras Server Status</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 16px;
      background-color: #30200b;
      font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    .status {
      width: 100%;
      max-width: 420px;
      text-align: center;
      padding: 32px 24px;
      border: 1px solid #776138;
      border-radius: 8px;
      background-color: #3f290e;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    }
    img { max-width: 150px; height: auto; margin-bottom: 16px; }
    h1 {
      margin: 0 0 12px;
      color: #d9b166;
      font-family: "GFS Didot", "Bodoni Moda", Georgia, serif;
      font-weight: 400;
      font-size: 28px;
    }
    p { margin: 8px 0; color: #fbf7f0; line-height: 1.5; }
    a { color: #e6cb98; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="status">
    <img src="/logo.svg" alt="Belioras logo">
    <h1>Belioras Server is Live</h1>
    <p>The Belioras server is up and running.</p>
    <p><a href="/api/v1/health">Check the database and cache status</a></p>
  </div>
</body>
</html>`;
