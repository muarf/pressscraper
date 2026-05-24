package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

public class PDFPrintHelper {

    public interface PDFPrintCallback {
        void onSuccess(String path);
        void onError(String error);
    }

    public static void print(final PrintDocumentAdapter printAdapter, final PrintAttributes attributes, final File pdfFile, final PDFPrintCallback callback) {
        printAdapter.onLayout(null, attributes, null, new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                try {
                    ParcelFileDescriptor pfd = ParcelFileDescriptor.open(pdfFile,
                        ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);

                    printAdapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, pfd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                        @Override
                        public void onWriteFinished(PageRange[] pages) {
                            try {
                                pfd.close();
                                callback.onSuccess(pdfFile.getAbsolutePath());
                            } catch (Exception e) {
                                callback.onError("Erreur fermeture fichier: " + e.getMessage());
                            }
                        }

                        @Override
                        public void onWriteFailed(CharSequence error) {
                            try {
                                pfd.close();
                            } catch (Exception e) {
                                // ignore
                            }
                            callback.onError("Écriture PDF échouée: " + error);
                        }
                    });
                } catch (Exception e) {
                    callback.onError("Erreur ouverture fichier: " + e.getMessage());
                }
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                callback.onError("Mise en page PDF échouée: " + error);
            }
        }, null);
    }
}
