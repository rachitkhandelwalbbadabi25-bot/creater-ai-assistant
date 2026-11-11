import { tick, start, stop } from '../src/scheduler/schedulerEngine.js';

async function testTick() {
  console.log('Running testTick()...');
  try {
    const execs = await tick();
    console.log('Tick succeeded! Executions:', execs);
  } catch (err: any) {
    console.error('Tick threw error:');
    console.error('Name:', err.name);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
  }
}

testTick();
