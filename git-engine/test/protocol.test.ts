import { describe, it, expect } from 'vitest';
import {
  pktLine,
  pktFlush,
  parsePktLines,
  advertiseRefs,
  parseUploadPackRequest,
  parseReceivePackRequest,
  createReceivePackResponse,
  createUploadPackResponse,
} from '../src/protocol';
import { encode, concat } from '../src/objects';

describe('pkt-line encoding', () => {
  it('encodes a simple line', () => {
    const result = pktLine('hello\n');
    const text = new TextDecoder().decode(result);
    expect(text).toBe('000ahello\n');
  });

  it('encodes flush packet', () => {
    const result = pktFlush();
    const text = new TextDecoder().decode(result);
    expect(text).toBe('0000');
  });
});

describe('pkt-line parsing', () => {
  it('parses multiple pkt-lines', () => {
    const data = encode('000ahello\n000bworld!\n0000');
    const lines = parsePktLines(data);
    expect(lines).toEqual(['hello', 'world!', null]);
  });

  it('handles empty input', () => {
    const lines = parsePktLines(new Uint8Array(0));
    expect(lines).toEqual([]);
  });
});

describe('advertiseRefs', () => {
  it('advertises refs for upload-pack', () => {
    const refs = [
      { name: 'HEAD', sha: 'a'.repeat(40) },
      { name: 'refs/heads/main', sha: 'a'.repeat(40) },
    ];

    const result = advertiseRefs('git-upload-pack', refs);
    const text = new TextDecoder().decode(result);

    expect(text).toContain('# service=git-upload-pack');
    expect(text).toContain('a'.repeat(40) + ' HEAD');
    expect(text).toContain('multi_ack');
    expect(text).toContain('refs/heads/main');
  });

  it('advertises empty repo with zero-id', () => {
    const result = advertiseRefs('git-upload-pack', []);
    const text = new TextDecoder().decode(result);

    expect(text).toContain('0'.repeat(40));
    expect(text).toContain('capabilities^{}');
  });

  it('advertises refs for receive-pack', () => {
    const refs = [{ name: 'refs/heads/main', sha: 'b'.repeat(40) }];
    const result = advertiseRefs('git-receive-pack', refs);
    const text = new TextDecoder().decode(result);

    expect(text).toContain('# service=git-receive-pack');
    expect(text).toContain('report-status');
    expect(text).toContain('delete-refs');
  });
});

describe('parseUploadPackRequest', () => {
  it('parses wants and done', () => {
    const data = concat(
      pktLine('want ' + 'a'.repeat(40) + ' multi_ack side-band-64k\n'),
      pktLine('want ' + 'b'.repeat(40) + '\n'),
      pktFlush(),
      pktLine('done\n'),
    );

    const result = parseUploadPackRequest(data);
    expect(result.wants).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
    expect(result.capabilities).toContain('multi_ack');
    expect(result.capabilities).toContain('side-band-64k');
    expect(result.done).toBe(true);
    expect(result.haves).toEqual([]);
  });

  it('parses wants, haves, and done', () => {
    const data = concat(
      pktLine('want ' + 'a'.repeat(40) + '\n'),
      pktFlush(),
      pktLine('have ' + 'c'.repeat(40) + '\n'),
      pktLine('have ' + 'd'.repeat(40) + '\n'),
      pktLine('done\n'),
    );

    const result = parseUploadPackRequest(data);
    expect(result.wants).toEqual(['a'.repeat(40)]);
    expect(result.haves).toEqual(['c'.repeat(40), 'd'.repeat(40)]);
    expect(result.done).toBe(true);
  });
});

describe('parseReceivePackRequest', () => {
  it('parses ref updates with capabilities', () => {
    const oldSha = '0'.repeat(40);
    const newSha = 'a'.repeat(40);
    const packData = encode('PACK');

    const data = concat(
      pktLine(`${oldSha} ${newSha} refs/heads/main\0report-status\n`),
      pktFlush(),
      packData,
    );

    const result = parseReceivePackRequest(data);
    expect(result.commands).toEqual([
      { oldSha, newSha, name: 'refs/heads/main' },
    ]);
    expect(result.capabilities).toContain('report-status');
    expect(result.packfileData.length).toBeGreaterThan(0);
  });

  it('parses multiple ref updates', () => {
    const data = concat(
      pktLine(`${'0'.repeat(40)} ${'a'.repeat(40)} refs/heads/main\0report-status\n`),
      pktLine(`${'b'.repeat(40)} ${'c'.repeat(40)} refs/heads/feature\n`),
      pktFlush(),
    );

    const result = parseReceivePackRequest(data);
    expect(result.commands.length).toBe(2);
    expect(result.commands[1]!.name).toBe('refs/heads/feature');
  });
});

describe('createReceivePackResponse', () => {
  it('creates success response', () => {
    const response = createReceivePackResponse('ok', [
      { name: 'refs/heads/main', status: 'ok' },
    ]);
    const text = new TextDecoder().decode(response);

    expect(text).toContain('unpack ok');
    expect(text).toContain('ok refs/heads/main');
  });

  it('creates error response', () => {
    const response = createReceivePackResponse('ok', [
      { name: 'refs/heads/main', status: 'non-fast-forward' },
    ]);
    const text = new TextDecoder().decode(response);

    expect(text).toContain('ng refs/heads/main non-fast-forward');
  });
});

describe('createUploadPackResponse', () => {
  it('wraps packfile in sideband', () => {
    const packfile = encode('PACK fake data');
    const response = createUploadPackResponse(packfile, 'Compressing objects...\n');

    // Should start with NAK
    const text = new TextDecoder().decode(response.subarray(0, 12));
    expect(text).toContain('NAK');

    // Should contain packfile data (band 1 = 0x01)
    let foundBand1 = false;
    for (let i = 0; i < response.length; i++) {
      if (response[i] === 0x01) {
        foundBand1 = true;
        break;
      }
    }
    expect(foundBand1).toBe(true);
  });
});
