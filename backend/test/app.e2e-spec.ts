import { Test, TestingModule } from '@nestjs/testing';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApplication } from './../src/app.setup';

class ValidationProbeDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}

// Only registered in this test module; adds no production endpoint.
@Controller('__test/validation')
class ValidationProbeController {
  @Post()
  create(@Body() body: ValidationProbeDto) {
    return {
      quantity: body.quantity,
      transformed: body instanceof ValidationProbeDto,
    };
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Hello World!');
  });

  it('executes a query against PostgreSQL', async () => {
    const result: unknown = await app.get(DataSource).query('SELECT 1 AS ok');
    expect(result).toEqual([{ ok: 1 }]);
  });

  it('serves Swagger and its OpenAPI document', async () => {
    await request(app.getHttpServer())
      .get('/docs/')
      .expect(200)
      .expect(/swagger-ui/);
    await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200)
      .expect((response) => {
        const document = response.body as { info: { title: string } };
        expect(document.info.title).toBe('Payment Checkout API');
      });
  });

  it('transforms valid bodies into DTO instances', () => {
    return request(app.getHttpServer())
      .post('/__test/validation')
      .send({ quantity: 1 })
      .expect(201)
      .expect({ quantity: 1, transformed: true });
  });

  it('rejects unexpected fields', () => {
    return request(app.getHttpServer())
      .post('/__test/validation')
      .send({ quantity: 1, unexpected: true })
      .expect(400);
  });

  it('rejects invalid DTO values', () => {
    return request(app.getHttpServer())
      .post('/__test/validation')
      .send({ quantity: 0 })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
