import { describe, it, expect } from '@rstest/core';
import { classifyGatewayIdentity } from './classify-gateway-identity';

const userinfo = (claims: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(claims)).toString('base64');

describe('classifyGatewayIdentity', () => {
  describe('User', () => {
    it('should classify X-Userinfo as a user', () => {
      expect(
        classifyGatewayIdentity({
          'x-userinfo': userinfo({ sub: 'user-1', email: 'a@b.c' }),
          // The OIDC plugin also sets X-Credential-Identifier (preferred_username)
          'x-credential-identifier': 'alice',
        }),
      ).toEqual({
        authType: 'user',
        user: { id: 'user-1', email: 'a@b.c' },
      });
    });

    it('should give no identity for an unparseable X-Userinfo', () => {
      expect(classifyGatewayIdentity({ 'x-userinfo': 'garbage' })).toBeNull();
    });
  });

  describe('Conflicting identities', () => {
    it.each([
      ['x-api-key-id', 'key-1'],
      ['x-api-key-consumer', 'acme'],
    ])('should report a conflict for X-Userinfo with %s', (name, value) => {
      expect(
        classifyGatewayIdentity({
          'x-userinfo': userinfo({ sub: 'user-1' }),
          [name]: value,
        }),
      ).toEqual({ authType: 'conflict' });
    });

    it('should report a conflict even when X-Userinfo is unparseable', () => {
      expect(
        classifyGatewayIdentity({
          'x-userinfo': 'garbage',
          'x-api-key-id': 'key-1',
          'x-api-key-consumer': 'acme',
        }),
      ).toEqual({ authType: 'conflict' });
    });

    it('should not treat X-Credential-Identifier as a key identity (OIDC sets it)', () => {
      expect(
        classifyGatewayIdentity({
          'x-userinfo': userinfo({ sub: 'user-1' }),
          'x-credential-identifier': 'alice',
        }),
      ).toEqual({ authType: 'user', user: { id: 'user-1' } });
    });
  });

  describe('API key', () => {
    it('should classify the key plugin headers as an API key', () => {
      expect(
        classifyGatewayIdentity({
          'x-api-key-id': 'key-1',
          'x-api-key-consumer': 'acme-corp',
        }),
      ).toEqual({
        authType: 'apiKey',
        apiKey: { id: 'key-1', consumer: 'acme-corp' },
      });
    });

    it('should ignore an incomplete key plugin header pair', () => {
      expect(classifyGatewayIdentity({ 'x-api-key-id': 'key-1' })).toBeNull();
    });

    it('should ignore key-auth consumer headers (no identity)', () => {
      expect(
        classifyGatewayIdentity({
          'x-consumer-username': 'acme-corp',
          'x-consumer-id': 'consumer-uuid',
          'x-credential-identifier': 'credential-uuid',
        }),
      ).toBeNull();
    });

    it('should classify X-Userinfo with X-Consumer-Username as the user', () => {
      expect(
        classifyGatewayIdentity({
          'x-userinfo': userinfo({ sub: 'user-1' }),
          'x-consumer-username': 'acme',
        }),
      ).toEqual({ authType: 'user', user: { id: 'user-1' } });
    });
  });

  describe('No identity', () => {
    it('should return null without identity headers', () => {
      expect(classifyGatewayIdentity({})).toBeNull();
    });

    it('should not treat X-Consumer-Id alone as a user', () => {
      expect(classifyGatewayIdentity({ 'x-consumer-id': 'user-1' })).toBeNull();
    });

    it('should not treat X-Credential-Identifier alone as a user', () => {
      expect(
        classifyGatewayIdentity({ 'x-credential-identifier': 'user-1' }),
      ).toBeNull();
    });

    it('should ignore legacy X-JWT-Claim-* headers', () => {
      expect(
        classifyGatewayIdentity({ 'x-jwt-claim-email': 'a@b.c' }),
      ).toBeNull();
    });
  });
});
