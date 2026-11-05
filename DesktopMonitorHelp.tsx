import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DesktopMonitorHelp() {
  return (
    <details className="border-t border-border pt-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Monitor className="h-4 w-4" /> Alternative: screen mirroring guide
      </summary>
      <div className="mt-3 space-y-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Setup guide only · LensPrompt is not connected to your PC.</p>
        <p>Windows does not natively receive iPhone AirPlay mirroring. Phone Link and Wireless Display are not iPhone camera monitors.</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Install a reputable Windows AirPlay receiver, such as AirServer or Reflector. These are separate products; check current pricing and compatibility.</li>
          <li>Connect the iPhone and PC to the same trusted Wi-Fi network. Enable the receiver’s password or on-screen connection approval. Do not open router ports or share over public Wi-Fi.</li>
          <li>Start the receiver. On iPhone, open Control Centre → Screen Mirroring → select your PC and enter the receiver’s code if requested.</li>
          <li>Return to LensPrompt in Safari, allow camera and microphone access, select the rear camera, and keep the phone upright. Use the PC image to frame yourself, then start recording on the iPhone.</li>
          <li>Finish recording on the iPhone. To disconnect, open Control Centre → Screen Mirroring → Stop Mirroring, then quit the PC receiver.</li>
        </ol>
        <p>This mirrors the entire iPhone screen, including script, controls and possible notifications—not a clean camera feed. Hide controls and enable Do Not Disturb if desired. The script remains excluded from LensPrompt’s saved recording.</p>
        <p>Expect delay and possible battery drain. Keep Safari open and the phone unlocked. Test a short rear-camera recording while mirroring first; receiver and iOS compatibility can vary. This workflow has not been verified on a physical iPhone and Windows PC.</p>
        <p>For a clean camera-only feed, use the Desktop Monitor pairing above instead. Native iOS camera processing remains separate Swift work.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="link" size="sm"><a href="https://support.apple.com/en-us/102661" target="_blank" rel="noopener noreferrer">Apple mirroring guide ↗</a></Button>
          <Button asChild variant="link" size="sm"><a href="https://www.airserver.com/PC" target="_blank" rel="noopener noreferrer">AirServer for Windows ↗</a></Button>
          <Button asChild variant="link" size="sm"><a href="https://www.airsquirrels.com/reflector" target="_blank" rel="noopener noreferrer">Reflector ↗</a></Button>
        </div>
      </div>
    </details>
  );
}