import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('app', () => {
  const schema = Joi.object({
    NODE_ENV: Joi.string()
      .valid('development', 'production', 'test')
      .required(),
    PORT: Joi.number().required(),
  });

  const { error, value } = schema.validate(process.env, {
    allowUnknown: true,
  });

  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  return {
    env: value.NODE_ENV,
    port: value.PORT,
  };
});
