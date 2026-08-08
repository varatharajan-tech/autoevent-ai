import { FileVideo, Loader2 } from "lucide-react";
import { useSignedUrl } from "@/lib/storage";

type Props = {
  bucket: string;
  path: string | null;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: "none" | "metadata" | "auto";
};

export function StorageVideo({
  bucket,
  path,
  className = "",
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  preload = "metadata",
}: Props) {
  const { url, loading, error } = useSignedUrl(bucket, path);

  if (loading) {
    return (
      <div className={`${className} bg-muted animate-pulse grid place-items-center`}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className={`${className} bg-muted grid place-items-center text-muted-foreground`}>
        <div className="text-center p-3">
          <FileVideo className="size-5 mx-auto mb-1" />
          <div className="text-[10px]">Video unavailable</div>
        </div>
      </div>
    );
  }

  return (
    <video
      src={url}
      className={className}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      preload={preload}
      playsInline
    />
  );
}
