<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep browser capture and compositing in the client-only camera studio; native capture requires a separate implementation because browser APIs cannot provide native AVFoundation processing.
- Generate person alpha in the pure personMask helper and test it independently; reset the output canvas every frame so transparent images cannot retain stale pixels.
- Desktop Monitor is setup help, not network transport; no signaling or receiver exists, so pairing must never imply a connection.
