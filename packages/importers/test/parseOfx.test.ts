import { describe, expect, test } from 'bun:test';

import { ImportError } from '../src/errors';
import { parseOfx } from '../src/parseOfx';

// Realistic OFX 1.x: SGML header block, leaf elements without closing tags,
// aggregate closes present, DTPOSTED with time + zone suffix.
const OFX_1X = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260316093000[+8:MYT]
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STMTRS>
<CURDEF>MYR
<BANKACCTFROM>
<BANKID>MBBEMYKL
<ACCTID>512345678901
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301000000
<DTEND>20260315235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260302120000[+8:MYT]
<TRNAMT>-45.90
<FITID>2026030201
<NAME>POS PURCHASE
<MEMO>COFFEE BEAN KLCC
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260305
<TRNAMT>4500.00
<FITID>2026030502
<NAME>SALARY MARCH
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260310
<TRNAMT>-120.00
<FITID>2026031003
<MEMO>TNB BILL
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>8334.10
<DTASOF>20260315
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

// OFX 2.x: XML declaration + processing instruction, closing tags everywhere,
// entity-encoded value, and a second (credit card) statement in the same file.
const OFX_2X = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1</TRNUID>
      <STMTRS>
        <CURDEF>USD</CURDEF>
        <BANKACCTFROM>
          <BANKID>021000021</BANKID>
          <ACCTID>987654321</ACCTID>
          <ACCTTYPE>SAVINGS</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20260401080000.000[-5:EST]</DTPOSTED>
            <TRNAMT>250.00</TRNAMT>
            <FITID>A-1001</FITID>
            <NAME>SMITH &amp; SONS REFUND</NAME>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260402</DTPOSTED>
            <TRNAMT>-19.99</TRNAMT>
            <FITID>A-1002</FITID>
            <NAME>STREAMING</NAME>
            <MEMO>MONTHLY PLAN</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>2</TRNUID>
      <CCSTMTRS>
        <CURDEF>USD</CURDEF>
        <CCACCTFROM>
          <ACCTID>4111-XXXX</ACCTID>
        </CCACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260403</DTPOSTED>
            <TRNAMT>-75.50</TRNAMT>
            <FITID>CC-2001</FITID>
            <NAME>RESTAURANT</NAME>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>
`;

describe('parseOfx', () => {
  test('OFX 1.x SGML: header ignored, unclosed leaves parsed, one account group', () => {
    const { statements, skipped } = parseOfx(OFX_1X);
    expect(skipped).toEqual([]);
    expect(statements).toHaveLength(1);
    const statement = statements[0];
    expect(statement.accountId).toBe('512345678901');
    expect(statement.currency).toBe('MYR');
    expect(statement.lines).toEqual([
      {
        id: '2026030201',
        date: '2026-03-02',
        description: 'POS PURCHASE COFFEE BEAN KLCC',
        amount: -4590,
        currency: 'MYR',
      },
      {
        id: '2026030502',
        date: '2026-03-05',
        description: 'SALARY MARCH',
        amount: 450_000,
        currency: 'MYR',
      },
      {
        id: '2026031003',
        date: '2026-03-10',
        description: 'TNB BILL',
        amount: -12_000,
        currency: 'MYR',
      },
    ]);
  });

  test('OFX 2.x XML: multiple statements come back as separate account groups', () => {
    const { statements, skipped } = parseOfx(OFX_2X);
    expect(skipped).toEqual([]);
    expect(statements).toHaveLength(2);
    expect(statements[0].accountId).toBe('987654321');
    expect(statements[0].lines.map((line) => line.id)).toEqual([
      'A-1001',
      'A-1002',
    ]);
    // Entity decoding and time/zone-suffix stripping.
    expect(statements[0].lines[0].description).toBe('SMITH & SONS REFUND');
    expect(statements[0].lines[0].date).toBe('2026-04-01');
    // Signs pass through untouched: OFX is already account-holder-signed.
    expect(statements[0].lines[0].amount).toBe(25_000);
    expect(statements[0].lines[1].amount).toBe(-1999);
    expect(statements[1]).toMatchObject({
      accountId: '4111-XXXX',
      currency: 'USD',
    });
    expect(statements[1].lines[0].amount).toBe(-7550);
  });

  test('missing CURDEF falls back to the defaultCurrency option', () => {
    const noCurdef = OFX_1X.replace('<CURDEF>MYR\n', '');
    const { statements } = parseOfx(noCurdef, { defaultCurrency: 'MYR' });
    expect(statements[0].currency).toBe('MYR');
    expect(statements[0].lines).toHaveLength(3);
  });

  test('missing CURDEF with no fallback throws a typed error', () => {
    const noCurdef = OFX_1X.replace('<CURDEF>MYR\n', '');
    let caught: unknown;
    try {
      parseOfx(noCurdef);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportError);
    expect((caught as ImportError).code).toBe('OFX_CURRENCY_MISSING');
  });

  test('transactions missing FITID or TRNAMT are skipped with their ordinal', () => {
    const broken = OFX_1X.replace('<FITID>2026030502\n', '').replace(
      '<TRNAMT>-120.00\n',
      ''
    );
    const { statements, skipped } = parseOfx(broken);
    expect(statements[0].lines.map((line) => line.id)).toEqual(['2026030201']);
    expect(skipped).toEqual([
      { line: 2, reason: expect.stringContaining('FITID') },
      { line: 3, reason: expect.stringContaining('TRNAMT') },
    ]);
  });

  test('malformed DTPOSTED is a skip, not an abort', () => {
    const badDate = OFX_1X.replace(
      '<DTPOSTED>20260302120000[+8:MYT]\n',
      '<DTPOSTED>garbage\n'
    );
    const { statements, skipped } = parseOfx(badDate);
    expect(statements[0].lines).toHaveLength(2);
    expect(skipped).toEqual([
      { line: 1, reason: expect.stringContaining('YYYYMMDD') },
    ]);
  });

  test('comma-decimal TRNAMT parses, but grouped amounts fail loudly', () => {
    const commaDecimal = OFX_1X.replace('<TRNAMT>-45.90\n', '<TRNAMT>-45,90\n');
    const { statements } = parseOfx(commaDecimal);
    expect(statements[0].lines[0].amount).toBe(-4590);

    const grouped = OFX_1X.replace('<TRNAMT>4500.00\n', '<TRNAMT>4.500,00\n');
    const { skipped } = parseOfx(grouped);
    expect(skipped).toHaveLength(1);
  });

  test('a file with no OFX envelope throws OFX_STRUCTURE', () => {
    let caught: unknown;
    try {
      parseOfx('this,is,a,csv\n1,2,3,4\n');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportError);
    expect((caught as ImportError).code).toBe('OFX_STRUCTURE');
  });
});
