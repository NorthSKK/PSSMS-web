const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
let _authClient = null;

async function getAuth() {
  if (_authClient) return _authClient;
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', process.env.GOOGLE_KEY_FILE || 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _authClient = await auth.getClient();
  return _authClient;
}

async function getSheetValues(sheetName) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  return res.data.values || [];
}

async function updateRange(sheetName, a1Range, values) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${a1Range}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values },
  });
}

async function batchUpdate(sheetName, updates) {
  if (!updates.length) return;
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'USER_ENTERED',
      data: updates.map(u => ({ range: `${sheetName}!${u.range}`, values: u.values })),
    },
  });
}

async function appendRow(sheetName, values) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [values] },
  });
}

module.exports = { getSheetValues, updateRange, batchUpdate, appendRow };
