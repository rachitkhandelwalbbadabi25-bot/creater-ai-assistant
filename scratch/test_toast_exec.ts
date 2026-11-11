import { exec } from 'child_process';

async function testToast(title: string, message: string): Promise<boolean> {
  const psCommand = `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $textNodes = $template.GetElementsByTagName('text')
    $textNodes.Item(0).AppendChild($template.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null
    $textNodes.Item(1).AppendChild($template.CreateTextNode('${message.replace(/'/g, "''")}')) | Out-Null
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')
    $notification = [Windows.UI.Notifications.ToastNotification]::new($template)
    $notifier.Show($notification)
  `.trim().replace(/\n/g, '; ');

  return new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${psCommand}"`, { windowsHide: true }, (err) => {
      if (err) {
        console.error('PowerShell toast error:', err);
        resolve(false);
      } else {
        console.log('PowerShell toast succeeded!');
        resolve(true);
      }
    });
  });
}

testToast('Creater AI — Reminder', "It's time to open YouTube.")
  .then((res) => console.log('Result:', res))
  .catch((err) => console.error('Error:', err));
