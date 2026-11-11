import notifier from 'node-notifier';

console.log('Testing node-notifier on Windows...');
console.log('Platform:', process.platform);

notifier.notify(
  {
    title: 'Creater AI — Test Toast',
    message: 'This is a test notification from node-notifier.',
    wait: true, // wait for callback
    timeout: 5,
  },
  (err, response, metadata) => {
    console.log('Notifier callback fired!');
    console.log('Error:', err);
    console.log('Response:', response);
    console.log('Metadata:', metadata);
  }
);

setTimeout(() => {
  console.log('Test completed.');
  process.exit(0);
}, 6000);
