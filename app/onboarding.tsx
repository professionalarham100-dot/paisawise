import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    Animated,
    Dimensions,
    FlatList,
    Image,
    ListRenderItemInfo,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Versioned key avoids stale Expo Go AsyncStorage surviving reinstalls.
export const HAS_SEEN_ONBOARDING_KEY = "has_seen_onboarding_v2";

const { width } = Dimensions.get("window");

type OnboardingSlide = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
};

function OnboardingSlideItem({
  item,
  isActive,
  onSkip,
  isCompleting,
}: {
  item: OnboardingSlide;
  isActive: boolean;
  onSkip: () => void;
  isCompleting: boolean;
}) {
  const fade = useRef(new Animated.Value(isActive ? 1 : 0.25)).current;
  const lift = useRef(new Animated.Value(isActive ? 0 : 16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: isActive ? 1 : 0.35,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: isActive ? 0 : 14,
        damping: 18,
        stiffness: 150,
        mass: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, isActive, lift]);

  return (
    <View style={styles.slide}>
      <View style={styles.bgGlowA} />
      <View style={styles.bgGlowB} />
      <View style={styles.topRow}>
        <View style={styles.brandWrap}>
          <Image source={require("../assets/PW_Center_1_Neon.png")} style={styles.brandIcon} />
          <View>
            <Text
              
              style={styles.brandTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              PaisaWise
            </Text>
            <Text
              
              style={styles.brandSubtitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              AI Budget Planner
            </Text>
          </View>
        </View>
        <Pressable onPress={onSkip} style={styles.skipBtn} disabled={isCompleting}>
          <Text  style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>
      <Animated.View style={[styles.centerWrap, { opacity: fade, transform: [{ translateY: lift }] }]}>
        <View style={styles.emojiRing}>
          <Text  style={styles.emoji}>{item.emoji}</Text>
        </View>
        <View style={styles.contentCard}>
          <Text  style={styles.title}>{item.title}</Text>
          <Text  style={styles.subtitle}>{item.subtitle}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const slides: OnboardingSlide[] = [
  {
    id: "track",
    emoji: "💰",
    title: "Apna Paisa Track Karo",
    subtitle: "Har kharch record karo, AI batayega kahan paisa ja raha hai",
  },
  {
    id: "roast",
    emoji: "🔥",
    title: "Apni Spending pe Roast Suno",
    subtitle: "AI judge karega tera budget — honest, funny, aur bilkul sach",
  },
  {
    id: "goals",
    emoji: "🎯",
    title: "Apne Goals Poore Karo",
    subtitle: "Saving goals set karo aur PaisaWise track karega tera progress",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList<OnboardingSlide> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  const completeOnboarding = async () => {
    if (isCompleting) {
      return;
    }
    setIsCompleting(true);
    try {
      await AsyncStorage.setItem(HAS_SEEN_ONBOARDING_KEY, "true");
      const written = await AsyncStorage.getItem(HAS_SEEN_ONBOARDING_KEY);
      if (written !== "true") {
        await AsyncStorage.setItem(HAS_SEEN_ONBOARDING_KEY, "true");
      }
      router.replace("/welcome");
    } catch (e) {
      console.log("completeOnboarding failed:", e);
      router.replace("/welcome");
    } finally {
      setIsCompleting(false);
    }
  };

  const getItemLayout = (_data: ArrayLike<OnboardingSlide> | null | undefined, index: number) => ({
    length: width,
    offset: width * index,
    index,
  });

  const goToNextSlide = () => {
    if (activeIndex >= slides.length - 1) {
      return;
    }
    const next = activeIndex + 1;
    try {
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
    } catch {
      flatListRef.current?.scrollToOffset({ offset: width * next, animated: true });
    }
    setActiveIndex(next);
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const index = viewableItems[0]?.index;
    if (typeof index === "number") {
      setActiveIndex(index);
    }
  }).current;

  const renderItem = ({ item, index }: ListRenderItemInfo<OnboardingSlide>) => (
    <OnboardingSlideItem
      item={item}
      isActive={activeIndex === index}
      onSkip={() => {
        void completeOnboarding();
      }}
      isCompleting={isCompleting}
    />
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <FlatList
        ref={flatListRef}
        style={styles.list}
        data={slides}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        bounces={false}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
        getItemLayout={getItemLayout}
        initialNumToRender={slides.length}
        maxToRenderPerBatch={slides.length}
        windowSize={5}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50, minimumViewTime: 80 }}
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollToIndexFailed={({ index }) => {
          const offset = index * width;
          flatListRef.current?.scrollToOffset({ offset, animated: true });
        }}
      />

      <View style={[styles.footer, { bottom: 24 }]} pointerEvents="box-none">
        <View style={styles.dotRow} pointerEvents="box-none">
          {slides.map((slide, index) => (
            <View
              key={slide.id}
              style={[styles.dot, index === activeIndex && styles.dotActive]}
            />
          ))}
        </View>
        {activeIndex === slides.length - 1 ? (
          <Pressable
            onPress={() => {
              void completeOnboarding();
            }}
            style={[styles.startButton, isCompleting && styles.startButtonDisabled]}
            disabled={isCompleting}
          >
            <Text  style={styles.startButtonText}>
              {isCompleting ? "Loading..." : "Shuru Karo 🚀"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={goToNextSlide}
            style={styles.nextButton}
            accessibilityRole="button"
            accessibilityLabel="Next onboarding slide"
          >
            <Text  style={styles.nextButtonText}>
              Next →
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#060d08",
  },
  list: {
    flex: 1,
  },
  slide: {
    width,
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: "#060d08",
    overflow: "hidden",
  },
  bgGlowA: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,136,0.12)",
    top: -80,
    left: -60,
  },
  bgGlowB: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,136,0.08)",
    bottom: 60,
    right: -70,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 8,
    gap: 8,
  },
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
  },
  brandTitle: {
    color: "#eafff3",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  brandSubtitle: {
    color: "#85c9a8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  skipText: {
    color: "#00ff88",
    fontSize: 15,
    fontWeight: "800",
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 88,
    gap: 14,
  },
  emojiRing: {
    width: 118,
    height: 118,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.3)",
    backgroundColor: "rgba(5,20,14,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 58,
  },
  contentCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.16)",
    backgroundColor: "rgba(10, 24, 17, 0.72)",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  title: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 26,
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "#c5d1ca",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  dotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  dotActive: {
    width: 22,
    backgroundColor: "#00ff88",
  },
  startButton: {
    width: "100%",
    borderRadius: 12,
    backgroundColor: "#00ff88",
    paddingVertical: 14,
    alignItems: "center",
  },
  startButtonDisabled: {
    opacity: 0.72,
  },
  startButtonText: {
    color: "#04170f",
    fontSize: 15,
    fontWeight: "900",
  },
  nextButton: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.45)",
    backgroundColor: "rgba(0,255,136,0.12)",
    paddingVertical: 14,
    alignItems: "center",
  },
  nextButtonText: {
    color: "#00ff88",
    fontSize: 15,
    fontWeight: "900",
  },
});
