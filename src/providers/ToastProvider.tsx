import { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
} from 'react-native';
import { theme } from '@/src/lib/theme';

type ToastType = 'error' | 'success' | 'info';

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export const useToast = () => useContext(ToastContext);

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [type, setType] = useState<ToastType>('info');
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(-80)).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, t: ToastType = 'info') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setMessage(msg);
    setType(t);
    setVisible(true);

    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();

    timeoutRef.current = setTimeout(() => {
      Animated.timing(translateY, {
        toValue: -80,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setVisible(false));
    }, 3000);
  }, [translateY]);

  const bgColor =
    type === 'error' ? 'rgba(248,113,113,0.15)' :
    type === 'success' ? 'rgba(74,222,128,0.15)' :
    'rgba(255,255,255,0.1)';

  const borderColor =
    type === 'error' ? 'rgba(248,113,113,0.3)' :
    type === 'success' ? 'rgba(74,222,128,0.3)' :
    'rgba(255,255,255,0.15)';

  const textColor =
    type === 'error' ? '#f87171' :
    type === 'success' ? '#4ade80' :
    theme.text;

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {visible && (
        <Animated.View
          style={[
            styles.toast,
            {
              transform: [{ translateY }],
              backgroundColor: bgColor,
              borderColor,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={[styles.toastText, { color: textColor }]}>{message}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    zIndex: 9999,
  },
  toastText: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
  },
});
