const DEFAULT_KEY = 'tdSQ4QZEaQPPff7e4wMReKjhnwXecJUxJTdAVDGIql9xR3fIAf';

function generatePaerToken(key = DEFAULT_KEY) {
  const timestamp = Math.floor(Date.now() / 1000);
  const rand1 = Math.random().toString(36).substring(2, 12);
  const rand2 = Math.random().toString(36).substring(2, 12);
  const randomStr = rand1 + rand2;
  const raw = `${timestamp}|${randomStr}|${key}`;
  return Buffer.from(raw, 'utf8').toString('base64');
}

module.exports = {
  generatePaerToken,
  DEFAULT_KEY
};
