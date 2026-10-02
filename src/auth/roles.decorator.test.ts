import { describe, it, expect } from '@rstest/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.constants';

type Handler = () => void;

const handlerWithRoles = (...roles: string[]): Handler => {
  const handler: Handler = () => undefined;
  Roles(...roles)(handler);
  return handler;
};

describe('Roles', () => {
  it('should set the roles metadata', () => {
    const handler = handlerWithRoles('ADMIN', 'EDITOR');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      'ADMIN',
      'EDITOR',
    ]);
  });

  it('should set the roles metadata on a controller class', () => {
    class AdminController {}
    Roles('ADMIN')(AdminController);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([
      RolesGuard,
    ]);
  });

  it('should apply RolesGuard', () => {
    const handler = handlerWithRoles('ADMIN');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
  });
});
