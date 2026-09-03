import DateTimePicker from "@react-native-community/datetimepicker";
import { Fragment } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EXPENSE_CATEGORIES } from "../constants/categories";
import type { Expense } from "../storage/expenses";

const formatExpenseDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-PK", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export type ExpenseModalsProps = {
  isIncomeModalVisible: boolean;
  incomeDraft: string;
  incomeError: string;
  closeIncomeModal: () => void;
  saveIncome: () => Promise<void>;
  setIncomeDraft: (v: string) => void;
  setIncomeError: (v: string) => void;
  isEditModalVisible: boolean;
  editTitleDraft: string;
  editAmountDraft: string;
  editCategoryDraft: string;
  editDateDraft: string;
  editError: string;
  isSavingEdit: boolean;
  closeEditExpenseModal: () => void;
  saveEditedExpense: () => Promise<void>;
  setEditTitleDraft: (v: string) => void;
  setEditAmountDraft: (v: string) => void;
  setEditCategoryDraft: (v: string) => void;
  openEditDatePicker: () => void;
  actionExpense: Expense | null;
  closeExpenseActions: () => void;
  openEditExpenseModal: (item: Expense) => void;
  handleDeleteExpense: (item: Expense) => void;
  isEditDatePickerVisible: boolean;
  editDatePickerDraft: Date;
  setEditDatePickerDraft: (d: Date) => void;
  confirmEditDatePicker: () => void;
  setIsEditDatePickerVisible: (v: boolean) => void;
};

export default function ExpenseModals(props: ExpenseModalsProps) {
  const {
    isIncomeModalVisible,
    incomeDraft,
    incomeError,
    closeIncomeModal,
    saveIncome,
    setIncomeDraft,
    setIncomeError,
    isEditModalVisible,
    editTitleDraft,
    editAmountDraft,
    editCategoryDraft,
    editDateDraft,
    editError,
    isSavingEdit,
    closeEditExpenseModal,
    saveEditedExpense,
    setEditTitleDraft,
    setEditAmountDraft,
    setEditCategoryDraft,
    openEditDatePicker,
    actionExpense,
    closeExpenseActions,
    openEditExpenseModal,
    handleDeleteExpense,
    isEditDatePickerVisible,
    editDatePickerDraft,
    setEditDatePickerDraft,
    confirmEditDatePicker,
    setIsEditDatePickerVisible,
  } = props;

  return (
    <Fragment>
      <Modal
        visible={isIncomeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeIncomeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text  style={styles.modalTitle}>Monthly Income</Text>
            <Text  style={styles.modalSubtitle}>
              Updates your profile salary (PKR) — same value PaisaWise uses everywhere.
            </Text>

            <TextInput
              value={incomeDraft}
              onChangeText={(text) => {
                setIncomeDraft(text);
                if (incomeError) {
                  setIncomeError("");
                }
              }}
              placeholder="250000"
              placeholderTextColor="#6b7280"
              keyboardType="decimal-pad"
              style={styles.modalInput}
            />

            {incomeError ? (
              <Text  style={styles.modalError}>{incomeError}</Text>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable onPress={closeIncomeModal} style={styles.modalSecondary}>
                <Text  style={styles.modalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveIncome} style={styles.modalPrimary}>
                <Text  style={styles.modalPrimaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isEditModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeEditExpenseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text  style={styles.modalTitle}>Edit Expense</Text>
            <Text  style={styles.modalSubtitle}>
              Update title, amount, category, and date.
            </Text>

            <TextInput
              value={editTitleDraft}
              onChangeText={setEditTitleDraft}
              placeholder="Title"
              placeholderTextColor="#6b7280"
              style={styles.modalInput}
            />
            <TextInput
              value={editAmountDraft}
              onChangeText={setEditAmountDraft}
              placeholder="Amount (PKR)"
              placeholderTextColor="#6b7280"
              keyboardType="decimal-pad"
              style={styles.modalInput}
            />
            <Text  style={styles.modalCategoryLabel}>Category</Text>
            <View style={styles.modalCategoryContainer}>
              {EXPENSE_CATEGORIES.map((category) => {
                const selected = editCategoryDraft === category;
                return (
                  <Pressable
                    key={category}
                    onPress={() => setEditCategoryDraft(category)}
                    style={[
                      styles.modalCategoryChip,
                      selected && styles.modalCategoryChipSelected,
                    ]}
                  >
                    <Text
                      
                      style={[
                        styles.modalCategoryText,
                        selected && styles.modalCategoryTextSelected,
                      ]}
                    >
                      {category}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={openEditDatePicker} style={styles.modalDatePressable}>
              <Text  style={styles.modalDateText}>{formatExpenseDate(editDateDraft)}</Text>
            </Pressable>

            {editError ? <Text  style={styles.modalError}>{editError}</Text> : null}

            <View style={styles.modalActions}>
              <Pressable onPress={closeEditExpenseModal} style={styles.modalSecondary}>
                <Text  style={styles.modalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEditedExpense}
                style={[styles.modalPrimary, isSavingEdit && styles.ctaMuted]}
                disabled={isSavingEdit}
              >
                <Text  style={styles.modalPrimaryText}>
                  {isSavingEdit ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(actionExpense)}
        transparent
        animationType="fade"
        onRequestClose={closeExpenseActions}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text  style={styles.modalTitle}>{actionExpense?.name ?? "Expense"}</Text>
            <Text  style={styles.modalSubtitle}>Choose an action</Text>

            <View style={styles.modalActionsColumn}>
              <Pressable
                onPress={() => {
                  const target = actionExpense;
                  closeExpenseActions();
                  if (target) {
                    openEditExpenseModal(target);
                  }
                }}
                style={styles.actionMenuButton}
              >
                <Text  style={styles.actionMenuButtonText}>✏️ Edit</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const target = actionExpense;
                  closeExpenseActions();
                  if (target) {
                    void handleDeleteExpense(target);
                  }
                }}
                style={styles.actionMenuDelete}
              >
                <Text  style={styles.actionMenuDeleteText}>🗑️ Delete</Text>
              </Pressable>
              <Pressable onPress={closeExpenseActions} style={styles.actionMenuButton}>
                <Text  style={styles.actionMenuButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isEditDatePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditDatePickerVisible(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <DateTimePicker
              value={editDatePickerDraft}
              mode="date"
              display={Platform.OS === "android" ? "default" : "spinner"}
              onChange={(_, date) => {
                if (date) {
                  setEditDatePickerDraft(date);
                }
              }}
            />
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => setIsEditDatePickerVisible(false)}
                style={[styles.pickerActionButton, styles.pickerCancelButton]}
              >
                <Text  style={styles.pickerCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmEditDatePicker}
                style={[styles.pickerActionButton, styles.pickerConfirmButton]}
              >
                <Text  style={styles.pickerConfirmText}>Confirm ✓</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Fragment>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  modalCard: {
    backgroundColor: "#111111",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1f1f1f",
    padding: 16,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
    fontWeight: "600",
  },
  modalInput: {
    marginTop: 14,
    backgroundColor: "#0d0d0d",
    borderWidth: 1,
    borderColor: "#272727",
    borderRadius: 14,
    color: "#f8fafc",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalCategoryLabel: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 8,
  },
  modalCategoryContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modalCategoryChip: {
    width: "48%",
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: "#0d0d0d",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  modalCategoryChipSelected: {
    backgroundColor: "#00ff88",
  },
  modalCategoryText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  modalCategoryTextSelected: {
    color: "#04170f",
    fontWeight: "800",
  },
  modalDatePressable: {
    marginTop: 14,
    backgroundColor: "#0d0d0d",
    borderWidth: 1,
    borderColor: "#272727",
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  modalDateText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
  },
  modalError: {
    color: "#ff6b6b",
    marginTop: 10,
    fontSize: 13,
    fontWeight: "700",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  modalActionsColumn: {
    marginTop: 16,
    gap: 10,
  },
  actionMenuButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#0f0f0f",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionMenuButtonText: {
    color: "#e5e7eb",
    fontSize: 16,
    fontWeight: "800",
  },
  actionMenuDelete: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 77, 77, 0.6)",
    backgroundColor: "#2a1111",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionMenuDeleteText: {
    color: "#ff8f8f",
    fontSize: 16,
    fontWeight: "900",
  },
  modalSecondary: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#0f0f0f",
    paddingVertical: 12,
    alignItems: "center",
  },
  modalSecondaryText: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "800",
  },
  modalPrimary: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#00ff88",
    paddingVertical: 12,
    alignItems: "center",
  },
  ctaMuted: {
    opacity: 0.65,
  },
  modalPrimaryText: {
    color: "#04170f",
    fontSize: 15,
    fontWeight: "900",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    paddingBottom: Platform.OS === "android" ? 24 : 0,
  },
  pickerSheet: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingBottom: 18,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,255,136,0.2)",
  },
  pickerActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  pickerActionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pickerCancelButton: {
    backgroundColor: "#242424",
    borderColor: "#383838",
  },
  pickerConfirmButton: {
    backgroundColor: "#00ff88",
    borderColor: "#33ffa3",
  },
  pickerCancelText: {
    color: "#d1d5db",
    fontSize: 15,
    fontWeight: "800",
  },
  pickerConfirmText: {
    color: "#04170f",
    fontSize: 15,
    fontWeight: "900",
  },
});
