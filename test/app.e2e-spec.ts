import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('requires a consumer key and fails closed when Redis is unavailable', async () => {
    const oldClients = process.env.API_CLIENTS;
    const oldRedis = process.env.REDIS_URL;
    process.env.API_CLIENTS = JSON.stringify({ house: 'a'.repeat(40) });
    delete process.env.REDIS_URL;
    try {
      await request(app.getHttpServer()).get('/v1/provider-catalog').expect(401);
      await request(app.getHttpServer()).get('/v1/provider-catalog').set('x-api-key', 'b'.repeat(40)).expect(401);
      await request(app.getHttpServer()).get('/v1/provider-catalog').set('x-api-key', 'a'.repeat(40)).expect(503);
      process.env.API_CLIENTS = JSON.stringify({ house: 'a'.repeat(40), another: 'a'.repeat(40) });
      await request(app.getHttpServer()).get('/v1/provider-catalog').set('x-api-key', 'a'.repeat(40)).expect(401);
    } finally {
      if (oldClients === undefined) delete process.env.API_CLIENTS; else process.env.API_CLIENTS = oldClients;
      if (oldRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedis;
    }
  });

  afterEach(async () => {
    await app.close();
  });
});
